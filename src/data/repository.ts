import Dexie from "dexie";

import { createUserDatabase, db, type MementoDatabase, type SyncProgress } from "@/data/database";
import type { BatchStickerSaveInput, BatchUploadItemRecord, BatchUploadJobRecord, BatchUploadSnapshot } from "@/data/batchUploads";
import { defaultAssets, defaultJournalPages, defaultJournals, defaultStickers } from "@/data/defaults";
import {
  assetRecordSchema,
  journalPageRecordSchema,
  journalRecordSchema,
  settingsRecordSchema,
  stickerRecordSchema,
  type AppSnapshot,
  type AssetRecord,
  type CanvasJournalPageRecord,
  type ChangeRecord,
  type JournalPageRecord,
  type JournalRecord,
  type SettingsRecord,
  type StickerRecord
} from "@/domain/model";
import { canvasDocumentFromPlacements, emptyCanvasDocument } from "@/domain/editor";
import { isCanvasJournalPage } from "@/domain/model";

import { MAX_SYNC_RECORD_BYTES, shouldApplyRecord, syncEntitySchema, type SyncEntity } from "@/domain/syncProtocol";

const currentSettings = (): SettingsRecord => ({
  id: "app",
  schemaVersion: 2,
  updatedAt: Date.now()
});

const retiredDefaultStickers = new Map([
  ["sample-1", "asset-sample-1"],
  ["sample-2", "asset-sample-2"]
]);

function nextRevision(record: { revision: number }): number {
  return record.revision + 1;
}

export const shouldApplyRemoteRecord = shouldApplyRecord;

async function recordChange(database: MementoDatabase, change: Omit<ChangeRecord, "sequence">): Promise<void> {
  await database.changeLog.add(change);
}

export class LocalRepository {
  constructor(private readonly database: MementoDatabase = db) {}

  async initialize(): Promise<void> {
    // React StrictMode may close this instance during the first effect cleanup.
    // Explicit open also makes reusing a repository after account teardown safe.
    if (!this.database.isOpen()) await this.database.open();
    const settings = await this.database.settings.get("app");
    if (!settings) await this.database.transaction("rw", [this.database.assets, this.database.stickers, this.database.journals, this.database.journalPages, this.database.settings], async () => {
      await this.database.assets.bulkPut(defaultAssets);
      await this.database.stickers.bulkPut(defaultStickers);
      await this.database.journals.bulkPut(defaultJournals);
      await this.database.journalPages.bulkPut(defaultJournalPages);
      await this.database.settings.put(currentSettings());
    });
    await this.removeRetiredDefaultStickers();
  }

  private async removeRetiredDefaultStickers(): Promise<void> {
    const [stickers, journalPages] = await Promise.all([this.database.stickers.toArray(), this.database.journalPages.toArray()]);
    const timestamp = Date.now();
    const stickerUpdates = stickers
      .filter((sticker) => sticker.deletedAt === undefined && retiredDefaultStickers.get(sticker.id) === sticker.assetId)
      .map((sticker) => stickerRecordSchema.parse({ ...sticker, revision: nextRevision(sticker), updatedAt: timestamp, deletedAt: timestamp }));
    const journalPageUpdates = journalPages.flatMap((page) => {
      if (isCanvasJournalPage(page)) {
        const objects = page.canvasDocument.objects.filter((object) => object.kind !== "sticker" || !retiredDefaultStickers.has(object.stickerId));
        if (objects.length === page.canvasDocument.objects.length) return [];
        const canvasDocument = { ...page.canvasDocument, objects };
        const entries = page.history.entries.map((entry) => ({ ...entry, objects: entry.objects.filter((object) => object.kind !== "sticker" || !retiredDefaultStickers.has(object.stickerId)) }));
        return [journalPageRecordSchema.parse({ ...page, revision: nextRevision(page), updatedAt: timestamp, canvasDocument, history: { ...page.history, entries } })];
      }
      const placements = page.placements.filter((placement) => !retiredDefaultStickers.has(placement.id));
      const entries = page.history.entries.map((entry) => entry.filter((placement) => !retiredDefaultStickers.has(placement.id)));
      if (placements.length === page.placements.length && entries.every((entry, index) => entry.length === page.history.entries[index]?.length)) return [];
      return [journalPageRecordSchema.parse({ ...page, revision: nextRevision(page), updatedAt: timestamp, placements, history: { ...page.history, entries } })];
    });
    if (!stickerUpdates.length && !journalPageUpdates.length) return;

    await this.database.transaction("rw", [this.database.stickers, this.database.journalPages, this.database.changeLog], async () => {
      await this.database.stickers.bulkPut(stickerUpdates);
      await this.database.journalPages.bulkPut(journalPageUpdates);
      for (const sticker of stickerUpdates) {
        await recordChange(this.database, { entityType: "sticker", entityId: sticker.id, operation: "delete", revision: sticker.revision, changedAt: timestamp });
      }
      for (const page of journalPageUpdates) {
        await recordChange(this.database, { entityType: "journalPage", entityId: page.id, operation: "put", revision: page.revision, changedAt: timestamp });
      }
    });
  }

  async migrateJournalPagesToCanvas(): Promise<number> {
    const pages = await this.database.journalPages.filter((page) => page.deletedAt === undefined).toArray();
    const timestamp = Date.now();
    const migrated = pages.flatMap((page): CanvasJournalPageRecord[] => {
      if (isCanvasJournalPage(page)) return [];
        const canvasDocument = canvasDocumentFromPlacements(page.placements);
        const entries = page.history.entries.map((placements) => canvasDocumentFromPlacements(placements));
        return [{
          id: page.id,
          revision: nextRevision(page),
          createdAt: page.createdAt,
          updatedAt: timestamp,
          deletedAt: page.deletedAt,
          journalId: page.journalId,
          pageNumber: page.pageNumber,
          canvasDocument,
          history: { entries: entries.length ? entries : [emptyCanvasDocument()], index: Math.min(page.history.index, Math.max(0, entries.length - 1)) }
        }];
      });
    if (!migrated.length) return 0;
    await this.database.transaction("rw", [this.database.journalPages, this.database.changeLog], async () => {
      await this.database.journalPages.bulkPut(migrated);
      for (const page of migrated) {
        await recordChange(this.database, { entityType: "journalPage", entityId: page.id, operation: "put", revision: page.revision, changedAt: timestamp });
      }
    });
    return migrated.length;
  }

  async snapshot(): Promise<AppSnapshot> {
    const [assets, stickers, journals, journalPages, settings] = await Promise.all([
      this.database.assets.filter((item) => item.deletedAt === undefined).toArray(),
      this.database.stickers.filter((item) => item.deletedAt === undefined).toArray(),
      this.database.journals.filter((item) => item.deletedAt === undefined).toArray(),
      this.database.journalPages.filter((item) => item.deletedAt === undefined).toArray(),
      this.database.settings.get("app")
    ]);
    return { assets, stickers, journals, journalPages, settings: settingsRecordSchema.parse(settings ?? currentSettings()) };
  }

  async putAsset(input: AssetRecord): Promise<AssetRecord> {
    const record = assetRecordSchema.parse(input);
    await this.database.transaction("rw", [this.database.assets, this.database.changeLog], async () => {
      await this.database.assets.put(record);
      await recordChange(this.database, { entityType: "asset", entityId: record.id, operation: "put", revision: record.revision, changedAt: record.updatedAt });
    });
    return record;
  }

  async putSticker(input: StickerRecord): Promise<StickerRecord> {
    const record = stickerRecordSchema.parse(input);
    await this.database.transaction("rw", [this.database.stickers, this.database.changeLog], async () => {
      await this.database.stickers.put(record);
      await recordChange(this.database, { entityType: "sticker", entityId: record.id, operation: "put", revision: record.revision, changedAt: record.updatedAt });
    });
    return record;
  }

  async createBatchUpload(input: { id: string; groupHints: string[]; items: Array<Pick<BatchUploadItemRecord, "id" | "sourceBlob" | "sourceName">> }): Promise<BatchUploadSnapshot> {
    const timestamp = Date.now();
    const job: BatchUploadJobRecord = { id: input.id, createdAt: timestamp, updatedAt: timestamp, status: "queued", groupHints: input.groupHints };
    const items: BatchUploadItemRecord[] = input.items.map((item) => ({
      ...item,
      jobId: job.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "queued",
      attempts: 0,
      selected: true,
    }));
    await this.database.transaction("rw", [this.database.batchUploadJobs, this.database.batchUploadItems], async () => {
      await this.database.batchUploadJobs.put(job);
      await this.database.batchUploadItems.bulkPut(items);
    });
    return { job, items };
  }

  async getBatchUpload(id: string): Promise<BatchUploadSnapshot | null> {
    const job = await this.database.batchUploadJobs.get(id);
    if (!job) return null;
    const items = await this.database.batchUploadItems.where("jobId").equals(id).sortBy("createdAt");
    return { job, items };
  }

  async latestBatchUpload(): Promise<BatchUploadSnapshot | null> {
    const jobs = await this.database.batchUploadJobs.orderBy("updatedAt").reverse().toArray();
    for (const job of jobs) {
      const snapshot = await this.getBatchUpload(job.id);
      if (snapshot?.items.length) return snapshot;
    }
    return null;
  }

  async updateBatchJob(id: string, update: Partial<Omit<BatchUploadJobRecord, "id" | "createdAt">>): Promise<void> {
    await this.database.batchUploadJobs.update(id, { ...update, updatedAt: Date.now() });
  }

  async updateBatchItem(id: string, update: Partial<Omit<BatchUploadItemRecord, "id" | "jobId" | "createdAt" | "sourceBlob" | "sourceName">>): Promise<void> {
    await this.database.batchUploadItems.update(id, { ...update, updatedAt: Date.now() });
  }

  /**
   * Atomically claim one ready-to-run item. Batch processing uses two workers;
   * without this transaction they could both observe and submit the same image.
   */
  async claimNextBatchItem(jobId: string): Promise<BatchUploadItemRecord | null> {
    const now = Date.now();
    return this.database.transaction("rw", [this.database.batchUploadJobs, this.database.batchUploadItems], async () => {
      const job = await this.database.batchUploadJobs.get(jobId);
      if (job?.status !== "processing") return null;
      const items = await this.database.batchUploadItems.where("jobId").equals(jobId).sortBy("createdAt");
      const candidate = items.find((item) => item.status === "queued" && (!item.retryAt || item.retryAt <= now));
      if (!candidate) return null;
      const claimed: BatchUploadItemRecord = {
        ...candidate,
        status: "processing",
        attempts: candidate.attempts + 1,
        error: undefined,
        retryAt: undefined,
        updatedAt: now,
      };
      await this.database.batchUploadItems.put(claimed);
      return claimed;
    });
  }

  async updateBatchItems(ids: string[], update: Partial<Omit<BatchUploadItemRecord, "id" | "jobId" | "createdAt" | "sourceBlob" | "sourceName">>): Promise<void> {
    const updatedAt = Date.now();
    await this.database.transaction("rw", this.database.batchUploadItems, async () => {
      for (const id of ids) await this.database.batchUploadItems.update(id, { ...update, updatedAt });
    });
  }

  async discardBatchUpload(id: string): Promise<void> {
    await this.database.transaction("rw", [this.database.batchUploadJobs, this.database.batchUploadItems], async () => {
      await this.database.batchUploadItems.where("jobId").equals(id).delete();
      await this.database.batchUploadJobs.delete(id);
    });
  }

  async saveBatchStickers(input: BatchStickerSaveInput[]): Promise<void> {
    if (!input.length) return;
    const timestamp = Date.now();
    const assets: AssetRecord[] = [];
    const stickers: StickerRecord[] = [];
    for (const item of input) {
      const stickerId = crypto.randomUUID();
      const assetId = `asset-${stickerId}`;
      const sourceAssetId = item.sourceBlob ? `source-${stickerId}` : undefined;
      assets.push(assetRecordSchema.parse({ id: assetId, revision: 1, createdAt: timestamp, updatedAt: timestamp, role: "render", mimeType: item.blob.type, blob: item.blob }));
      if (item.sourceBlob && sourceAssetId) {
        assets.push(assetRecordSchema.parse({ id: sourceAssetId, revision: 1, createdAt: timestamp, updatedAt: timestamp, role: "source", mimeType: item.sourceBlob.type, blob: item.sourceBlob }));
      }
      stickers.push(stickerRecordSchema.parse({
        id: stickerId, revision: 1, createdAt: timestamp, updatedAt: timestamp,
        name: item.name.trim() || "New sticker", group: item.group.trim() || "待整理", assetId, sourceAssetId,
        finish: item.finish, edgeThickness: item.edgeThickness, border: item.border,
        tilt: Math.round(Math.random() * 10 - 5),
      }));
    }
    await this.database.transaction("rw", [this.database.assets, this.database.stickers, this.database.batchUploadItems, this.database.changeLog], async () => {
      await this.database.assets.bulkPut(assets);
      await this.database.stickers.bulkPut(stickers);
      for (const asset of assets) await recordChange(this.database, { entityType: "asset", entityId: asset.id, operation: "put", revision: asset.revision, changedAt: timestamp });
      for (const sticker of stickers) await recordChange(this.database, { entityType: "sticker", entityId: sticker.id, operation: "put", revision: sticker.revision, changedAt: timestamp });
      await this.database.batchUploadItems.bulkDelete(input.map((item) => item.batchItemId));
    });
  }

  async updateSticker(id: string, update: Partial<Pick<StickerRecord, "name" | "group" | "finish" | "edgeThickness" | "border" | "tilt" | "sourceAssetId">>): Promise<StickerRecord> {
    const existing = await this.database.stickers.get(id);
    if (!existing) throw new Error("Sticker not found.");
    return await this.putSticker({ ...existing, ...update, revision: nextRevision(existing), updatedAt: Date.now() });
  }

  async deleteSticker(id: string): Promise<void> {
    const existing = await this.database.stickers.get(id);
    if (!existing) return;
    const updatedAt = Date.now();
    const deleted = stickerRecordSchema.parse({ ...existing, revision: nextRevision(existing), updatedAt, deletedAt: updatedAt });
    const assetIds = [...new Set([existing.assetId, existing.sourceAssetId].filter((value): value is string => Boolean(value)))];
    await this.database.transaction("rw", [this.database.assets, this.database.stickers, this.database.changeLog], async () => {
      for (const assetId of assetIds) {
        const asset = await this.database.assets.get(assetId);
        if (!asset || asset.deletedAt !== undefined) continue;
        const deletedAsset = assetRecordSchema.parse({ ...asset, revision: nextRevision(asset), updatedAt, deletedAt: updatedAt });
        await this.database.assets.put(deletedAsset);
        await recordChange(this.database, { entityType: "asset", entityId: assetId, operation: "delete", revision: deletedAsset.revision, changedAt: updatedAt });
      }
      await this.database.stickers.put(deleted);
      await recordChange(this.database, { entityType: "sticker", entityId: id, operation: "delete", revision: deleted.revision, changedAt: updatedAt });
    });
  }

  /**
   * Replaces the render asset in place so every journal placement keeps the
   * same stickerId. A source image is created only after the user confirms.
   */
  async replaceStickerCutout(id: string, input: { renderBlob: Blob; sourceBlob?: Blob }): Promise<StickerRecord> {
    const timestamp = Date.now();
    return await this.database.transaction("rw", [this.database.assets, this.database.stickers, this.database.changeLog], async () => {
      const sticker = await this.database.stickers.get(id);
      if (!sticker || sticker.deletedAt !== undefined) throw new Error("Sticker not found.");
      const renderAsset = await this.database.assets.get(sticker.assetId);
      if (!renderAsset || renderAsset.deletedAt !== undefined) throw new Error("Sticker image not found.");

      const nextRender = assetRecordSchema.parse({ ...renderAsset, role: "render", blob: input.renderBlob, mimeType: input.renderBlob.type, revision: nextRevision(renderAsset), updatedAt: timestamp });
      await this.database.assets.put(nextRender);
      await recordChange(this.database, { entityType: "asset", entityId: nextRender.id, operation: "put", revision: nextRender.revision, changedAt: timestamp });

      let sourceAssetId = sticker.sourceAssetId;
      if (input.sourceBlob) {
        const currentSource = sourceAssetId ? await this.database.assets.get(sourceAssetId) : undefined;
        if (currentSource && currentSource.deletedAt === undefined) {
          const nextSource = assetRecordSchema.parse({ ...currentSource, role: "source", blob: input.sourceBlob, mimeType: input.sourceBlob.type, revision: nextRevision(currentSource), updatedAt: timestamp });
          await this.database.assets.put(nextSource);
          await recordChange(this.database, { entityType: "asset", entityId: nextSource.id, operation: "put", revision: nextSource.revision, changedAt: timestamp });
        } else {
          sourceAssetId = `source-${crypto.randomUUID()}`;
          const nextSource = assetRecordSchema.parse({ id: sourceAssetId, revision: 1, createdAt: timestamp, updatedAt: timestamp, role: "source", mimeType: input.sourceBlob.type, blob: input.sourceBlob });
          await this.database.assets.put(nextSource);
          await recordChange(this.database, { entityType: "asset", entityId: nextSource.id, operation: "put", revision: nextSource.revision, changedAt: timestamp });
        }
      }
      const nextSticker = stickerRecordSchema.parse({ ...sticker, sourceAssetId, revision: nextRevision(sticker), updatedAt: timestamp });
      await this.database.stickers.put(nextSticker);
      await recordChange(this.database, { entityType: "sticker", entityId: nextSticker.id, operation: "put", revision: nextSticker.revision, changedAt: timestamp });
      return nextSticker;
    });
  }

  async putJournal(input: JournalRecord): Promise<JournalRecord> {
    const record = journalRecordSchema.parse(input);
    await this.database.transaction("rw", [this.database.journals, this.database.changeLog], async () => {
      await this.database.journals.put(record);
      await recordChange(this.database, { entityType: "journal", entityId: record.id, operation: "put", revision: record.revision, changedAt: record.updatedAt });
    });
    return record;
  }

  async putJournalPage(input: JournalPageRecord): Promise<JournalPageRecord> {
    const record = journalPageRecordSchema.parse(input);
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > MAX_SYNC_RECORD_BYTES) {
      throw new Error("这一页内容过大，无法同步。请删除部分贴纸后重试。");
    }
    await this.database.transaction("rw", [this.database.journalPages, this.database.changeLog], async () => {
      await this.database.journalPages.put(record);
      await recordChange(this.database, { entityType: "journalPage", entityId: record.id, operation: "put", revision: record.revision, changedAt: record.updatedAt });
    });
    return record;
  }

  async replaceSnapshot(snapshot: AppSnapshot): Promise<void> {
    const parsed = {
      assets: snapshot.assets.map((item) => assetRecordSchema.parse(item)),
      stickers: snapshot.stickers.map((item) => stickerRecordSchema.parse(item)),
      journals: snapshot.journals.map((item) => journalRecordSchema.parse(item)),
      journalPages: snapshot.journalPages.map((item) => journalPageRecordSchema.parse(item)),
      settings: settingsRecordSchema.parse(snapshot.settings)
    };
    await this.database.transaction("rw", [this.database.assets, this.database.stickers, this.database.journals, this.database.journalPages, this.database.settings, this.database.changeLog], async () => {
      await Promise.all([this.database.assets.clear(), this.database.stickers.clear(), this.database.journals.clear(), this.database.journalPages.clear(), this.database.changeLog.clear()]);
      await this.database.assets.bulkPut(parsed.assets);
      await this.database.stickers.bulkPut(parsed.stickers);
      await this.database.journals.bulkPut(parsed.journals);
      await this.database.journalPages.bulkPut(parsed.journalPages);
      await this.database.settings.put(parsed.settings);
    });
  }

  async changesAfter(sequence: number): Promise<ChangeRecord[]> {
    return await this.database.changeLog.where("sequence").above(sequence).toArray();
  }

  async syncPayload(change: ChangeRecord): Promise<Record<string, unknown> | null> {
    const table = change.entityType === "asset" ? this.database.assets
      : change.entityType === "sticker" ? this.database.stickers
        : change.entityType === "journal" ? this.database.journals
          : change.entityType === "journalPage" ? this.database.journalPages
            : null;
    const record = table ? await table.get(change.entityId) : undefined;
    if (!record) return null;
    if (change.entityType === "asset") {
      const asset = record as AssetRecord;
      // The sync adapter uploads the Blob before removing it from the JSON payload.
      // Dropping it here left a remoteKey pointing to an object that was never written to R2.
      return { ...asset };
    }
    return record;
  }

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    return this.database.assets.get(id);
  }

  /** Cache bytes only for the exact metadata version that initiated the download. */
  async cacheAssetBlob(expected: AssetRecord, blob: Blob): Promise<boolean> {
    return this.database.transaction("rw", this.database.assets, async () => {
      const current = await this.database.assets.get(expected.id);
      if (!current || current.deletedAt !== undefined || current.revision !== expected.revision
        || current.updatedAt !== expected.updatedAt || current.remoteKey !== expected.remoteKey) return false;
      if (!current.blob) await this.database.assets.put({ ...current, blob });
      return true;
    });
  }

  async prepareSyncProgress(legacy: { cursor: number; sequence: number }): Promise<SyncProgress> {
    return this.database.transaction("rw", this.database.syncProgress, async () => {
      const current = await this.database.syncProgress.get("cloud");
      if (current) return current;
      // Old acknowledgements may have skipped unsent records. Replay the retained
      // log, then enqueue one current-state repair, rather than trusting that mark.
      const progress: SyncProgress = { id: "cloud", cursor: legacy.cursor,
        confirmedSequence: 0, recoveryQueued: false, legacySequence: legacy.sequence };
      await this.database.syncProgress.put(progress);
      return progress;
    });
  }

  async getSyncProgress(): Promise<SyncProgress> {
    const progress = await this.database.syncProgress.get("cloud");
    if (!progress) throw new Error("Sync has not been initialized.");
    return progress;
  }

  async pendingSyncCount(): Promise<number> {
    const progress = await this.database.syncProgress.get("cloud");
    return this.database.changeLog.where("sequence").above(progress?.confirmedSequence ?? 0).count();
  }

  /** Once per upgraded account, include tombstones and records without a log (seeds/imports). */
  async enqueueSyncRecovery(): Promise<void> {
    await this.database.transaction("rw", [this.database.assets, this.database.stickers, this.database.journals,
      this.database.journalPages, this.database.changeLog, this.database.syncProgress], async () => {
      const progress = await this.getSyncProgress();
      if (progress.recoveryQueued) return;
      const tables = [
        ["asset", this.database.assets], ["sticker", this.database.stickers],
        ["journal", this.database.journals], ["journalPage", this.database.journalPages],
      ] as const;
      for (const [entityType, table] of tables) {
        for (const record of await table.toArray()) {
          await recordChange(this.database, { entityType, entityId: record.id,
            operation: record.deletedAt === undefined ? "put" : "delete", revision: record.revision, changedAt: record.updatedAt });
        }
      }
      await this.database.syncProgress.put({ ...progress, recoveryQueued: true });
    });
  }

  /** Merge and advance the durable cursor/ack in the same transaction. Pending edits always survive. */
  async applyRemote(entities: SyncEntity[], checkpoint: { cursor?: number; confirmedSequence?: number; authoritative?: boolean } = {}): Promise<void> {
    const parsed = entities.map((entity) => syncEntitySchema.parse(entity));
    await this.database.transaction("rw", [this.database.assets, this.database.stickers, this.database.journals,
      this.database.journalPages, this.database.changeLog, this.database.syncProgress], async () => {
      const progress = await this.database.syncProgress.get("cloud");
      const confirmedSequence = Math.max(progress?.confirmedSequence ?? 0, checkpoint.confirmedSequence ?? 0);
      const pending = new Set((await this.changesAfter(confirmedSequence)).map((change) => `${change.entityType}:${change.entityId}`));
      for (const entity of parsed) {
        if (pending.has(`${entity.entityType}:${entity.entityId}`)) continue;
        if (entity.entityType === "asset") {
          const incoming = assetRecordSchema.parse(entity.payload);
          const current = await this.database.assets.get(incoming.id);
          const sameVersion = current?.revision === incoming.revision && current.updatedAt === incoming.updatedAt;
          if (!current || checkpoint.authoritative || shouldApplyRecord(current, incoming) || sameVersion) {
            const keepBlob = sameVersion && current?.mimeType === incoming.mimeType && incoming.deletedAt === undefined ? current.blob : undefined;
            const merged = keepBlob ? { ...incoming, blob: keepBlob } : incoming;
            if (JSON.stringify(current) !== JSON.stringify(merged)) await this.database.assets.put(merged);
          }
        } else if (entity.entityType === "sticker") {
          const incoming = stickerRecordSchema.parse(entity.payload);
          const current = await this.database.stickers.get(incoming.id);
          if (checkpoint.authoritative ? JSON.stringify(current) !== JSON.stringify(incoming) : shouldApplyRecord(current, incoming)) await this.database.stickers.put(incoming);
        } else if (entity.entityType === "journal") {
          const incoming = journalRecordSchema.parse(entity.payload);
          const current = await this.database.journals.get(incoming.id);
          if (checkpoint.authoritative ? JSON.stringify(current) !== JSON.stringify(incoming) : shouldApplyRecord(current, incoming)) await this.database.journals.put(incoming);
        } else {
          const incoming = journalPageRecordSchema.parse(entity.payload);
          const current = await this.database.journalPages.get(incoming.id);
          if (checkpoint.authoritative ? JSON.stringify(current) !== JSON.stringify(incoming) : shouldApplyRecord(current, incoming)) await this.database.journalPages.put(incoming);
        }
      }
      if (progress && (checkpoint.cursor !== undefined || checkpoint.confirmedSequence !== undefined)) {
        await this.database.syncProgress.put({ ...progress, confirmedSequence,
          cursor: checkpoint.cursor ?? progress.cursor });
      }
    });
  }

  async clearForTests(): Promise<void> {
    await Dexie.delete(this.database.name);
    await this.database.open();
  }

  close(): void { this.database.close(); }
}

export const localRepository = new LocalRepository();
export function createUserRepository(userId: string): LocalRepository {
  return new LocalRepository(createUserDatabase(userId));
}
