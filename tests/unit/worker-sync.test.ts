import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"

import { handleMementoApi } from "../../worker/auth.ts"

class LocalStatement {
  constructor(private readonly database: DatabaseSync, private readonly sql: string, private readonly params: unknown[] = []) {}

  bind(...params: unknown[]): LocalStatement {
    return new LocalStatement(this.database, this.sql, params)
  }

  async run(): Promise<D1Result> { return this.execute() }

  execute(): D1Result {
    const result = this.database.prepare(this.sql).run(...this.params)
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } as unknown as D1Result
  }

  async first<T>(): Promise<T | null> {
    const row = this.database.prepare(this.sql).get(...this.params) as T | undefined
    return row ?? null
  }

  async all<T>(): Promise<D1Result<T>> {
    const rows = this.database.prepare(this.sql).all(...this.params) as T[]
    return { success: true, results: rows, meta: {} } as unknown as D1Result<T>
  }
}

class LocalDatabase {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string): LocalStatement {
    return new LocalStatement(this.database, sql)
  }

  async batch(statements: LocalStatement[]): Promise<D1Result[]> {
    this.database.exec("BEGIN")
    try {
      const results: D1Result[] = []
      for (const statement of statements) results.push(statement.execute())
      this.database.exec("COMMIT")
      return results
    } catch (cause) {
      this.database.exec("ROLLBACK")
      throw cause
    }
  }
}

class FakeAssets {
  readonly deleted: string[] = []
  private readonly objects = new Map<string, { size: number; etag: string; customMetadata: Record<string, string>; httpMetadata: { contentType: string } }>()

  async head(key: string) {
    return this.objects.get(key) ?? null
  }

  async get(key: string) {
    const object = this.objects.get(key)
    return object ? { ...object, body: new ReadableStream() } : null
  }

  async delete(key: string) {
    this.deleted.push(key)
    this.objects.delete(key)
  }

  async put() {
    throw new Error("unexpected asset put")
  }

  add(key: string, size = 10, customMetadata: Record<string, string> = {}) {
    this.objects.set(key, { size, etag: "etag-current", customMetadata, httpMetadata: { contentType: "image/png" } })
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function createEnv(): Promise<{ env: Env; database: DatabaseSync; assets: FakeAssets; token: string }> {
  const database = new DatabaseSync(":memory:")
  database.exec(readFileSync(new URL("../../migrations/0001_accounts_and_sync.sql", import.meta.url), "utf8"))
  database.exec(readFileSync(new URL("../../migrations/0002_asset_operations.sql", import.meta.url), "utf8"))
  database.prepare("INSERT INTO users (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run("user-1", "tester", "salt", "hash", 1)
  database.prepare("INSERT INTO user_usage (user_id, asset_bytes, updated_at) VALUES (?, 0, ?)").run("user-1", 1)
  const token = "session-token"
  database.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(await sha256("app-secret\u0000session-token"), "user-1", 1, Date.now() + 60_000)
  const assets = new FakeAssets()
  const env = {
    MEMENTO_DB: new LocalDatabase(database),
    MEMENTO_ASSETS: assets,
    APP_SECRET: "app-secret",
  } as unknown as Env
  return { env, database, assets, token }
}

function journalPayload(id: string, revision: number, updatedAt: number) {
  return { id, revision, createdAt: updatedAt - 100, updatedAt, title: "测试", year: "2026", pages: 1, currentPage: 1, cover: "cover-blue", paper: "paper-grid" }
}

function syncRequest(changes: unknown[], token = "session-token") {
  return new Request("https://memento.test/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://memento.test", Cookie: `__Host-memento_session=${token}` },
    body: JSON.stringify({ changes }),
  })
}

describe("worker sync transactions", () => {
  it("rolls back an entity when its change-log insert fails", async () => {
    const { env, database } = await createEnv()
    database.exec("CREATE TRIGGER fail_sync_log BEFORE INSERT ON sync_changes BEGIN SELECT RAISE(ABORT, 'simulated log failure'); END")
    const now = Date.now() - 1_000
    const change = { entityType: "journal", entityId: "journal-1", operation: "put", revision: 1, updatedAt: now, payload: journalPayload("journal-1", 1, now) }
    await expect(handleMementoApi(syncRequest([change]), env)).rejects.toThrow("simulated log failure")
    expect(database.prepare("SELECT COUNT(*) AS count FROM sync_entities").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM sync_changes").get()).toEqual({ count: 0 })
  })

  it("does not delete R2 for a stale delete rejected by LWW", async () => {
    const { env, database, assets } = await createEnv()
    const currentTime = Date.now() - 1_000
    const assetPayload = { id: "asset-a", revision: 2, createdAt: currentTime - 100, updatedAt: currentTime, role: "render", mimeType: "image/png", remoteKey: "users/user-1/assets/asset-a" }
    database.prepare("INSERT INTO sync_entities (user_id, entity_type, entity_id, revision, updated_at, deleted_at, payload) VALUES (?, ?, ?, ?, ?, NULL, ?)").run("user-1", "asset", "asset-a", 2, currentTime, JSON.stringify(assetPayload))
    assets.add("users/user-1/assets/asset-a")
    const change = { entityType: "asset", entityId: "asset-a", operation: "delete", revision: 1, updatedAt: currentTime - 500, payload: assetPayload }
    const response = await handleMementoApi(syncRequest([change]), env)
    expect(response?.status).toBe(200)
    expect(assets.deleted).toEqual([])
    await expect(response?.json()).resolves.toMatchObject({ accepted: ["asset:asset-a"], entities: [{ operation: "put", revision: 2 }] })
  })

  it("returns the final server entity when a stale write is acknowledged", async () => {
    const { env, database } = await createEnv()
    const currentTime = Date.now() - 1_000
    database.prepare("INSERT INTO sync_entities (user_id, entity_type, entity_id, revision, updated_at, deleted_at, payload) VALUES (?, ?, ?, ?, ?, NULL, ?)").run("user-1", "journal", "journal-1", 2, currentTime, JSON.stringify(journalPayload("journal-1", 2, currentTime)))
    const change = { entityType: "journal", entityId: "journal-1", operation: "put", revision: 1, updatedAt: currentTime - 500, payload: journalPayload("journal-1", 1, currentTime - 500) }
    const response = await handleMementoApi(syncRequest([change]), env)
    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toMatchObject({ accepted: ["journal:journal-1"], cursor: 0, entities: [{ entityId: "journal-1", revision: 2 }] })
  })

  it("rejects asset metadata when the stored image belongs to another version", async () => {
    const { env, database, assets } = await createEnv()
    const currentTime = Date.now() - 1_000
    const assetPayload = { id: "asset-a", revision: 1, createdAt: currentTime - 100, updatedAt: currentTime, role: "render", mimeType: "image/png", remoteKey: "users/user-1/assets/asset-a" }
    assets.add("users/user-1/assets/asset-a", 10, { revision: "2", updatedAt: String(currentTime + 1) })
    const change = { entityType: "asset", entityId: "asset-a", operation: "put", revision: 1, updatedAt: currentTime, payload: assetPayload }
    const response = await handleMementoApi(syncRequest([change]), env)
    expect(response?.status).toBe(409)
    await expect(response?.json()).resolves.toMatchObject({ code: "ASSET_VERSION_CONFLICT" })
    expect(database.prepare("SELECT COUNT(*) AS count FROM sync_entities").get()).toEqual({ count: 0 })
  })

  it("returns the current entity version on historical pull entries", async () => {
    const { env } = await createEnv()
    const now = Date.now() - 1000
    for (const revision of [1, 2]) {
      const time = now + revision
      const response = await handleMementoApi(syncRequest([{ entityType: "journal", entityId: "j", operation: "put", revision, updatedAt: time, payload: journalPayload("j", revision, time) }]), env)
      expect(response?.status).toBe(200)
    }
    const response = await handleMementoApi(new Request("https://memento.test/api/sync/pull?cursor=0", { headers: { Cookie: "__Host-memento_session=session-token" } }), env)
    const result = await response!.json() as { entities: Array<{ revision: number; payload: { revision: number } }> }
    expect(result.entities).toHaveLength(2)
    expect(result.entities.every((entry) => entry.revision === 2 && entry.payload.revision === 2)).toBe(true)
  })

  it("rejects a future timestamp and invalid payload without writing records", async () => {
    const { env, database } = await createEnv()
    const now = Date.now()
    const response = await handleMementoApi(syncRequest([{ entityType: "journal", entityId: "j", operation: "put", revision: 1, updatedAt: Number.MAX_SAFE_INTEGER, payload: journalPayload("j", 1, now) }]), env)
    expect(response?.status).toBe(400)
    expect(database.prepare("SELECT COUNT(*) AS n FROM sync_entities").get()).toEqual({ n: 0 })
  })

})
