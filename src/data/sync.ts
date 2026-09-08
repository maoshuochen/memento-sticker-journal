import { z } from "zod";
import type { LocalRepository } from "@/data/repository";
import { SYNC_BATCH_SIZE, SYNC_PULL_SIZE, shouldApplyRecord, syncEntitySchema, syncPullSchema, syncPushSchema, type SyncEntity } from "@/domain/syncProtocol";

export class SyncError extends Error {
  constructor(message: string, public readonly kind: "offline" | "auth" | "invalid" | "server", public readonly code = "", public readonly status = 0) {
    super(message);
    this.name = "SyncError";
  }
}

function legacyNumber(key: string): number {
  try {
    const value = Number(localStorage.getItem(key) ?? 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}

/** One durable outbox, one in-flight drain; repeated UI/focus events share its result. */
export class CloudSyncAdapter {
  private running: Promise<void> | null = null;
  private requested = false;
  private bootstrapped = false;
  private readonly remoteAssets = new Map<string, SyncEntity>();
  private readonly controller = new AbortController();

  constructor(private readonly repository: LocalRepository, private readonly userId: string) {}

  dispose(): void { this.controller.abort(); }
  initialize(): Promise<void> { return this.syncNow(); }

  private assertActive(): void {
    this.controller.signal.throwIfAborted();
  }

  private async api<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    this.assertActive();
    let response: Response;
    try {
      response = await fetch(url, { credentials: "same-origin", ...init,
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(30_000)]) });
    } catch (cause) {
      this.assertActive();
      throw new SyncError(cause instanceof Error && cause.name === "TimeoutError" ? "云同步超时，请重试。" : "网络不可用，修改已保存在此设备。", "offline");
    }
    this.assertActive();
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
      if (body.code === "ASSET_WRITE_CONFLICT") this.bootstrapped = false;
      const kind = response.status === 401 ? "auth" : response.status >= 500 || response.status === 429 ? "server" : "invalid";
      throw new SyncError(body.error ?? "云同步失败，请重试。", kind, body.code, response.status);
    }
    const value = await response.json().catch(() => undefined) as unknown;
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new SyncError("同步数据格式不正确，未确认本地修改。", "invalid", "INVALID_SYNC_RESPONSE");
    return parsed.data;
  }

  syncNow(): Promise<void> {
    if (this.controller.signal.aborted) return Promise.reject(new DOMException("Sync disposed", "AbortError"));
    this.requested = true;
    if (!this.running) {
      const drain = async () => {
        do {
          this.requested = false;
          await this.syncOnce();
        } while (this.requested || await this.repository.pendingSyncCount() > 0);
      };
      // Other tabs share this account's IndexedDB checkpoint. Web Locks prevent
      // an older request from acknowledging a newer tab's write.
      this.running = (typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request(`memento-sync:${this.userId}`, { signal: this.controller.signal }, drain)
        : drain()).finally(() => { this.running = null; });
    }
    return this.running;
  }

  private rememberAssets(entities: SyncEntity[]): void {
    for (const entity of entities) {
      if (entity.entityType === "asset") this.remoteAssets.set(entity.entityId, entity);
    }
  }

  private async mergeSnapshot(): Promise<void> {
    const remote = await this.api("/api/sync/snapshot", syncPullSchema);
    this.assertActive();
    this.remoteAssets.clear();
    this.rememberAssets(remote.entities);
    await this.repository.applyRemote(remote.entities, { cursor: remote.cursor, authoritative: true });
  }

  private async syncOnce(): Promise<void> {
    this.assertActive();
    if (!this.bootstrapped) {
      await this.repository.prepareSyncProgress({ cursor: legacyNumber(`memento-sync-cursor:${this.userId}`), sequence: legacyNumber(`memento-sync-sequence:${this.userId}`) });
      await this.mergeSnapshot();
      await this.repository.enqueueSyncRecovery();
      this.bootstrapped = true;
    }
    while (true) {
      this.assertActive();
      const progress = await this.repository.getSyncProgress();
      const batch = (await this.repository.changesAfter(progress.confirmedSequence)).slice(0, SYNC_BATCH_SIZE);
      if (!batch.length) break;
      const payload: SyncEntity[] = [];
      const latestChanges = [...new Map(batch.map((change) => [`${change.entityType}:${change.entityId}`, change])).values()];
      for (const change of latestChanges) {
        if (change.entityType === "settings") continue; // Device-local settings were never part of the cloud contract.
        const record = await this.repository.syncPayload(change);
        if (!record) throw new SyncError("本地同步记录缺失，已停止确认进度。", "invalid", "MISSING_SYNC_RECORD");
        if (change.entityType === "asset") {
          const known = this.remoteAssets.get(change.entityId);
          const needsUpload = !known || shouldApplyRecord(known, { revision: Number(record.revision), updatedAt: Number(record.updatedAt) });
          if (record.blob instanceof Blob && record.deletedAt === undefined && needsUpload) {
            const uploaded = await this.api(`/api/assets/${encodeURIComponent(change.entityId)}`,
              z.object({ remoteKey: z.string() }), { method: "PUT", headers: { "Content-Type": record.blob.type, "X-Asset-Revision": String(record.revision), "X-Asset-Updated-At": String(record.updatedAt) }, body: record.blob });
            record.remoteKey = uploaded.remoteKey;
          }
          // Tombstones still need a source reference after deleting cached bytes.
          if (!record.url && !record.remoteKey) record.remoteKey = `users/${this.userId}/assets/${change.entityId}`;
          delete record.blob;
        }
        const entity = syncEntitySchema.safeParse({ entityType: change.entityType, entityId: change.entityId,
          operation: record.deletedAt === undefined ? "put" : "delete", revision: record.revision, updatedAt: record.updatedAt, payload: record });
        if (!entity.success) throw new SyncError("本地记录无法同步，请检查内容。", "invalid", "INVALID_LOCAL_RECORD");
        payload.push(entity.data);
      }
      const result = payload.length ? await this.api("/api/sync/push", syncPushSchema, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes: payload }),
      }) : { entities: [], accepted: [], cursor: progress.cursor };
      if (payload.some((entity) => !result.accepted.includes(`${entity.entityType}:${entity.entityId}`))) {
        throw new SyncError("云端未确认完整批次，将保留记录以便重试。", "invalid", "INCOMPLETE_SYNC_ACK");
      }
      this.assertActive();
      const confirmedSequence = batch.at(-1)?.sequence;
      if (confirmedSequence === undefined) throw new SyncError("同步序号缺失。", "invalid");
      this.rememberAssets(result.entities ?? []);
      await this.repository.applyRemote(result.entities ?? [], { confirmedSequence });
      // Older servers lack canonical winners. Fetch them without discarding the outbox.
      if (!result.entities) await this.mergeSnapshot();
    }
    while (true) {
      const progress = await this.repository.getSyncProgress();
      let pulled;
      try {
        pulled = await this.api(`/api/sync/pull?cursor=${progress.cursor}`, syncPullSchema);
      } catch (cause) {
        if (cause instanceof SyncError && cause.code === "SYNC_CURSOR_EXPIRED") {
          await this.mergeSnapshot();
          break;
        }
        throw cause;
      }
      this.assertActive();
      if (pulled.cursor < progress.cursor || (pulled.cursor === progress.cursor && pulled.entities.length > 0)) {
        throw new SyncError("云端同步游标未正确推进。", "invalid", "INVALID_SYNC_CURSOR");
      }
      this.rememberAssets(pulled.entities);
      await this.repository.applyRemote(pulled.entities, { cursor: pulled.cursor });
      if (!(pulled.hasMore ?? pulled.entities.length >= SYNC_PULL_SIZE)) break;
    }
  }
}
