import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MementoDatabase } from "../../src/data/database";
import { LocalRepository } from "../../src/data/repository";
import { CloudSyncAdapter } from "../../src/data/sync";
import { shouldApplyRecord, syncEntitySchema, type SyncEntity } from "../../src/domain/syncProtocol";
import type { JournalRecord } from "../../src/domain/model";

const databases: MementoDatabase[] = [];
const adapters: CloudSyncAdapter[] = [];
afterEach(async () => {
  adapters.splice(0).forEach((adapter) => adapter.dispose());
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) await database.delete();
});
const journal = (id: string, updatedAt = 1000, title = id): JournalRecord => ({ id, revision: 1, createdAt: 1, updatedAt, title, year: "2026", pages: 1, currentPage: 1, cover: "cover-blue", paper: "paper-grid" });
const entity = (record: JournalRecord): SyncEntity => syncEntitySchema.parse({ entityType: "journal", entityId: record.id, revision: record.revision, updatedAt: record.updatedAt, operation: "put", payload: record });
async function repository(recovered = true) {
  const database = new MementoDatabase(`sync-test-${crypto.randomUUID()}`);
  databases.push(database);
  await database.open();
  const result = new LocalRepository(database);
  if (recovered) {
    await result.prepareSyncProgress({ cursor: 0, sequence: 0 });
    await result.enqueueSyncRecovery();
  }
  return { repository: result, database };
}
function adapter(repository: LocalRepository) {
  const sync = new CloudSyncAdapter(repository, "test-user");
  adapters.push(sync);
  return sync;
}
function server(initial: SyncEntity[] = []) {
  const records = new Map(initial.map((entry) => [`${entry.entityType}:${entry.entityId}`, entry]));
  const changes: Array<{ cursor: number; entity: SyncEntity }> = [];
  let cursor = initial.length;
  const batches: SyncEntity[][] = [];
  let failPush = 0;
  let expirePull = false;
  let snapshots = 0;
  let pulls = 0;
  const response = (value: unknown, status = 200) => Response.json(value, { status });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("snapshot")) { snapshots++; return response({ cursor, entities: [...records.values()] }); }
    if (url.endsWith("push")) {
      const body = JSON.parse(String(init?.body)) as { changes: SyncEntity[] };
      batches.push(body.changes);
      if (failPush === batches.length) return response({ error: "temporary" }, 503);
      for (const next of body.changes) {
        const key = `${next.entityType}:${next.entityId}`;
        if (shouldApplyRecord(records.get(key), next)) {
          records.set(key, next);
          changes.push({ cursor: ++cursor, entity: next });
        }
      }
      return response({ cursor, accepted: body.changes.map((entry) => `${entry.entityType}:${entry.entityId}`), entities: body.changes.map((entry) => records.get(`${entry.entityType}:${entry.entityId}`)) });
    }
    if (url.includes("/pull?")) {
      pulls++;
      if (expirePull) { expirePull = false; return response({ code: "SYNC_CURSOR_EXPIRED" }, 409); }
      const after = Number(new URL(url, "https://test.invalid").searchParams.get("cursor"));
      const all = changes.filter((entry) => entry.cursor > after);
      const page = all.slice(0, 100);
      return response({ cursor: page.at(-1)?.cursor ?? after, entities: page.map((entry) => entry.entity), hasMore: all.length > page.length });
    }
    if (url.includes("/assets/")) return response({ remoteKey: `users/test-user/assets/${url.split("/").at(-1)}` });
    throw new Error(`Unexpected URL ${url}`);
  }));
  return { records, batches, changes, failOnPush(n: number) { failPush = n; }, expire() { expirePull = true; }, get snapshots() { return snapshots; }, get pulls() { return pulls; } };
}

describe("durable cloud sync", () => {
  it.each([51, 100, 101])("uploads all %i changes and confirms only successful batches", async (count) => {
    const { repository: repo } = await repository();
    for (let i = 0; i < count; i++) await repo.putJournal(journal(`j-${i}`));
    const remote = server();
    await adapter(repo).initialize();
    expect(remote.records.size).toBe(count);
    expect(remote.batches.map((batch) => batch.length)).toEqual(count === 51 ? [50, 1] : count === 100 ? [50, 50] : [50, 50, 1]);
    expect((await repo.getSyncProgress()).confirmedSequence).toBe(count);
    expect(await repo.pendingSyncCount()).toBe(0);
    expect(remote.pulls).toBe(count > 100 ? 2 : 1);
  });

  it("keeps the failed second batch through restart and retries without a gap", async () => {
    const { repository: repo } = await repository();
    for (let i = 0; i < 101; i++) await repo.putJournal(journal(`j-${i}`));
    const remote = server(); remote.failOnPush(2);
    const first = adapter(repo);
    await expect(first.initialize()).rejects.toMatchObject({ kind: "server" });
    expect((await repo.getSyncProgress()).confirmedSequence).toBe(50);
    expect(await repo.pendingSyncCount()).toBe(51);
    first.dispose();
    await adapter(repo).initialize();
    expect(remote.records.size).toBe(101);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it("preserves offline edits across startup even when the cloud snapshot has records", async () => {
    const { repository: repo } = await repository();
    await repo.putJournal(journal("j", 3000, "offline edit"));
    const remote = server([entity(journal("j", 1000, "old cloud"))]);
    await adapter(repo).initialize();
    expect((await repo.snapshot()).journals[0]?.title).toBe("offline edit");
    expect(remote.records.get("journal:j")?.payload.title).toBe("offline edit");
  });

  it("merges the canonical winner when another device already has a newer edit", async () => {
    const { repository: repo } = await repository();
    await repo.putJournal(journal("j", 1000, "local"));
    server([entity(journal("j", 3000, "newer remote"))]);
    await adapter(repo).initialize();
    expect((await repo.snapshot()).journals[0]?.title).toBe("newer remote");
  });

  it("does not acknowledge a new edit made during an in-flight upload", async () => {
    const { repository: repo } = await repository();
    await repo.putJournal(journal("j"));
    server();
    const original = globalThis.fetch;
    let edited = false;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("push") && !edited) { edited = true; await repo.putJournal({ ...journal("j", 2000, "new edit"), revision: 2 }); }
      return original(url, init);
    });
    await adapter(repo).initialize();
    expect((await repo.snapshot()).journals[0]?.title).toBe("new edit");
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it("replays an unsafe legacy acknowledgement once, including deletion tombstones", async () => {
    const { repository: repo, database } = await repository(false);
    await repo.putJournal({ ...journal("deleted"), deletedAt: 1000 });
    vi.stubGlobal("localStorage", { getItem: () => "999" });
    const remote = server();
    await adapter(repo).initialize();
    expect(remote.records.get("journal:deleted")?.operation).toBe("delete");
    expect(await repo.getSyncProgress()).toMatchObject({ recoveryQueued: true, legacySequence: 999 });
    const count = await database.changeLog.count();
    await adapter(repo).initialize();
    expect(await database.changeLog.count()).toBe(count);
  });

  it("recovers an expired pull cursor without clearing an edit made during recovery", async () => {
    const { repository: repo } = await repository();
    await repo.putJournal(journal("j"));
    const remote = server();
    const sync = adapter(repo); await sync.initialize();
    remote.expire();
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("snapshot")) await repo.putJournal({ ...journal("j", 4000, "pending recovery"), revision: 2 });
      return original(url, init);
    });
    await sync.syncNow();
    expect((await repo.snapshot()).journals[0]?.title).toBe("pending recovery");
    expect(remote.records.get("journal:j")?.payload.title).toBe("pending recovery");
  });

  it.each([1000, 2000])("does not overwrite cloud image bytes at version time %i during replay", async (updatedAt) => {
    const { repository: repo } = await repository(false);
    const asset = { id: "asset-a", revision: 1, createdAt: 1, updatedAt: 1000, role: "render" as const, mimeType: "image/png", remoteKey: "users/test-user/assets/asset-a" };
    await repo.putAsset({ ...asset, blob: new Blob(["old bytes"], { type: "image/png" }) });
    server([syncEntitySchema.parse({ entityType: "asset", entityId: asset.id, operation: "put", revision: 1, updatedAt, payload: asset })]);
    await adapter(repo).initialize();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/assets/"))).toHaveLength(0);
    expect((await repo.getAsset(asset.id))?.updatedAt).toBe(updatedAt);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it("keeps matching cached bytes and caches downloads without creating uploads", async () => {
    const { repository: repo, database } = await repository();
    const asset = { id: "asset-a", revision: 1, createdAt: 1, updatedAt: 1000, role: "render" as const, mimeType: "image/png", remoteKey: "users/test-user/assets/asset-a" };
    await database.assets.put({ ...asset, blob: new Blob(["image"], { type: "image/png" }) });
    const incoming = syncEntitySchema.parse({ entityType: "asset", entityId: asset.id, operation: "put", revision: 1, updatedAt: 1000, payload: asset });
    await repo.applyRemote([incoming], { authoritative: true });
    expect((await repo.getAsset(asset.id))?.blob?.size).toBe(5);
    await database.assets.put({ ...asset, revision: 2, updatedAt: 2000 });
    expect(await repo.cacheAssetBlob(asset, new Blob(["stale"]))).toBe(false);
    expect(await repo.cacheAssetBlob({ ...asset, revision: 2, updatedAt: 2000 }, new Blob(["new"]))).toBe(true);
    expect(await repo.pendingSyncCount()).toBe(0);
  });

  it("shares concurrent sync requests and classifies auth and invalid responses", async () => {
    const { repository: repo } = await repository();
    server();
    const sync = adapter(repo);
    const a = sync.initialize(); const b = sync.syncNow();
    expect(a).toBe(b); await a;
    vi.stubGlobal("fetch", async () => Response.json({ error: "sign in" }, { status: 401 }));
    await expect(sync.syncNow()).rejects.toMatchObject({ kind: "auth" });
    vi.stubGlobal("fetch", async () => Response.json({ cursor: "bad", entities: [] }));
    await expect(sync.syncNow()).rejects.toMatchObject({ kind: "invalid" });
  });
});
