import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it, vi } from "vitest"

import { putAsset, deleteAsset, reconcileAssetOperations } from "../../worker/assets.ts"

type Params = unknown[]

class LocalStatement {
  constructor(private readonly database: DatabaseSync, private readonly sql: string, private readonly params: Params = []) {}

  bind(...params: Params): LocalStatement {
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

type StoredAsset = {
  size: number
  etag: string
  customMetadata: Record<string, string>
  httpMetadata: { contentType?: string }
}

class LocalBucket {
  readonly objects = new Map<string, StoredAsset>()
  failAfterStore = false
  putDelayMs = 0
  rejectCondition = false
  failBeforeStore = false
  failAfterDelete = false
  beforePut: (() => Promise<void>) | null = null
  beforeDelete: (() => Promise<void>) | null = null
  readonly putStarted: Promise<void>
  private resolvePutStarted!: () => void
  private etagCounter = 0

  constructor() {
    this.putStarted = new Promise((resolve) => { this.resolvePutStarted = resolve })
  }

  async head(key: string): Promise<StoredAsset | null> {
    return this.objects.get(key) ?? null
  }

  async put(key: string, bytes: Uint8Array, options: R2PutOptions): Promise<StoredAsset | null> {
    this.resolvePutStarted()
    if (this.beforePut) await this.beforePut()
    if (this.rejectCondition) return null
    if (this.failBeforeStore) throw new Error("unknown write result")
    if (this.putDelayMs) await new Promise((resolve) => setTimeout(resolve, this.putDelayMs))
    const current = this.objects.get(key)
    const condition = options.onlyIf as R2Conditional | undefined
    if (condition?.etagMatches !== undefined && current?.etag !== condition.etagMatches) return null
    if (condition?.etagDoesNotMatch !== undefined && ((condition.etagDoesNotMatch === "*" && current) || current?.etag === condition.etagDoesNotMatch)) return null
    const object: StoredAsset = {
      size: bytes.byteLength,
      etag: `etag-${++this.etagCounter}`,
      customMetadata: options.customMetadata ?? {},
      httpMetadata: { contentType: options.httpMetadata && "contentType" in options.httpMetadata ? options.httpMetadata.contentType : undefined },
    }
    this.objects.set(key, object)
    if (this.failAfterStore) {
      this.failAfterStore = false
      throw new Error("simulated timeout after R2 accepted the write")
    }
    return object
  }

  async delete(key: string): Promise<void> {
    if (this.beforeDelete) await this.beforeDelete()
    this.objects.delete(key)
    if (this.failAfterDelete) { this.failAfterDelete = false; throw new Error("unknown delete result") }
  }
}

function createEnv(): { env: Env; database: DatabaseSync; bucket: LocalBucket } {
  const database = new DatabaseSync(":memory:")
  database.exec(readFileSync(new URL("../../migrations/0001_accounts_and_sync.sql", import.meta.url), "utf8"))
  database.exec(readFileSync(new URL("../../migrations/0002_asset_operations.sql", import.meta.url), "utf8"))
  database.prepare("INSERT INTO users (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run("user-1", "tester", "salt", "hash", 1)
  database.prepare("INSERT INTO user_usage (user_id, asset_bytes, updated_at) VALUES (?, 0, ?)").run("user-1", 1)
  const bucket = new LocalBucket()
  const env = { MEMENTO_DB: new LocalDatabase(database), MEMENTO_ASSETS: bucket } as unknown as Env
  return { env, database, bucket }
}

function bytes(size: number, value = 7): Uint8Array {
  return new Uint8Array(size).fill(value)
}

describe("asset quota reservations", () => {
  it("rejects older or ambiguous image bytes without releasing another operation's quota", async () => {
    const { env, database, bucket } = createEnv()
    const version = { revision: 2, updatedAt: 2000 }
    await expect(putAsset(env, "user-1", "a", bytes(1024), "image/png", version)).resolves.toMatchObject({ kind: "committed" })
    const etag = bucket.objects.get("users/user-1/assets/a")?.etag
    for (const stale of [{ revision: 99, updatedAt: 1000 }, version, undefined]) {
      await expect(putAsset(env, "user-1", "a", bytes(2048, 8), "image/png", stale)).resolves.toMatchObject({ kind: "conflict" })
      expect(bucket.objects.get("users/user-1/assets/a")?.etag).toBe(etag)
      expect(database.prepare("SELECT asset_bytes FROM user_usage").get()).toEqual({ asset_bytes: 1024 })
    }
    await expect(putAsset(env, "user-1", "a", bytes(1024), "image/png", version)).resolves.toMatchObject({ kind: "committed" })
    database.close()
  })

  it("applies quota deltas atomically for replacement", async () => {
    const { env, database } = createEnv()
    await expect(putAsset(env, "user-1", "asset-a", bytes(30 * 1024 * 1024), "image/png")).resolves.toMatchObject({ kind: "committed" })
    await expect(putAsset(env, "user-1", "asset-a", bytes(25 * 1024 * 1024, 8), "image/png")).resolves.toMatchObject({ kind: "committed" })
    await expect(putAsset(env, "user-1", "asset-b", bytes(30 * 1024 * 1024), "image/png")).resolves.toMatchObject({ kind: "quota" })
    expect(database.prepare("SELECT asset_bytes FROM user_usage WHERE user_id = 'user-1'").get()).toEqual({ asset_bytes: 25 * 1024 * 1024 })
  })

  it("serializes concurrent operations on the same asset", async () => {
    const { env, database } = createEnv()
    const bucket = env.MEMENTO_ASSETS as unknown as LocalBucket
    bucket.putDelayMs = 20
    const first = putAsset(env, "user-1", "asset-a", bytes(1024), "image/png")
    await bucket.putStarted
    const second = putAsset(env, "user-1", "asset-a", bytes(1024, 8), "image/png")
    const results = await Promise.all([first, second])
    expect(results.filter((result) => result.kind === "committed")).toHaveLength(1)
    expect(results.filter((result) => result.kind === "busy" || result.kind === "conflict")).toHaveLength(1)
    expect(database.prepare("SELECT COUNT(*) AS count FROM asset_operations WHERE state IN ('reserved', 'unknown')").get()).toEqual({ count: 0 })
  })

  it("keeps an uncertain R2 write and recovers it from custom metadata", async () => {
    const { env, database, bucket } = createEnv()
    bucket.failAfterStore = true
    await expect(putAsset(env, "user-1", "asset-a", bytes(2048), "image/png")).resolves.toMatchObject({ kind: "unknown" })
    expect(database.prepare("SELECT state FROM asset_operations").get()).toEqual({ state: "unknown" })
    await expect(putAsset(env, "user-1", "asset-a", bytes(2048), "image/png")).resolves.toMatchObject({ kind: "committed" })
    expect(database.prepare("SELECT state FROM asset_operations ORDER BY created_at DESC LIMIT 1").get()).toEqual({ state: "committed" })
    expect(database.prepare("SELECT asset_bytes FROM user_usage WHERE user_id = 'user-1'").get()).toEqual({ asset_bytes: 2048 })
  })
})


describe("asset operation failure boundaries", () => {
  const MiB = 1024 * 1024
  function seed(database: DatabaseSync, bucket: LocalBucket, usage = 50 * MiB) {
    database.prepare("UPDATE user_usage SET asset_bytes = ?").run(usage)
    bucket.objects.set("users/user-1/assets/existing", { size: 5 * MiB, etag: "old", customMetadata: {}, httpMetadata: { contentType: "image/png" } })
  }
  it("allows only one of two concurrent 4 MiB uploads with 5 MiB remaining", async () => {
    const { env, database } = createEnv()
    database.prepare("UPDATE user_usage SET asset_bytes = ?").run(45 * MiB)
    const results = await Promise.all([putAsset(env, "user-1", "a", bytes(4 * MiB), "image/png"), putAsset(env, "user-1", "b", bytes(4 * MiB), "image/png")])
    expect(results.map((result) => result.kind).sort()).toEqual(["committed", "quota"])
    expect(database.prepare("SELECT asset_bytes FROM user_usage").get()).toEqual({ asset_bytes: 49 * MiB })
  })
  it.each(["shrink", "delete"])("does not release capacity until an in-flight %s completes", async (kind) => {
    const { env, database, bucket } = createEnv()
    seed(database, bucket)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    if (kind === "shrink") bucket.beforePut = () => gate
    else bucket.beforeDelete = () => gate
    const pending = kind === "shrink" ? putAsset(env, "user-1", "existing", bytes(MiB), "image/png") : deleteAsset(env, "user-1", "existing")
    await vi.waitFor(() => expect(database.prepare("SELECT COUNT(*) AS n FROM asset_operations WHERE state = 'reserved'").get()).toEqual({ n: 1 }))
    expect(database.prepare("SELECT asset_bytes FROM user_usage").get()).toEqual({ asset_bytes: 50 * MiB })
    await expect(putAsset(env, "user-1", "another", bytes(MiB), "image/png")).resolves.toMatchObject({ kind: "quota" })
    release()
    await expect(pending).resolves.toMatchObject({ kind: "committed" })
    expect(database.prepare("SELECT asset_bytes FROM user_usage").get()).toEqual({ asset_bytes: (kind === "shrink" ? 46 : 45) * MiB })
  })
  it("compensates a definite conditional failure exactly once", async () => {
    const { env, database, bucket } = createEnv()
    bucket.rejectCondition = true
    await expect(putAsset(env, "user-1", "a", bytes(MiB), "image/png")).resolves.toMatchObject({ kind: "conflict" })
    await reconcileAssetOperations(env)
    expect(database.prepare("SELECT asset_bytes FROM user_usage").get()).toEqual({ asset_bytes: 0 })
    expect(database.prepare("SELECT state, quota_released FROM asset_operations").get()).toEqual({ state: "failed", quota_released: 1 })
  })
  it("retains uncertain reservations when there is no positive R2 completion evidence", async () => {
    const { env, database, bucket } = createEnv()
    bucket.failBeforeStore = true
    await expect(putAsset(env, "user-1", "a", bytes(MiB), "image/png")).resolves.toMatchObject({ kind: "unknown" })
    bucket.failBeforeStore = false
    await expect(putAsset(env, "user-1", "a", bytes(MiB), "image/png")).resolves.toMatchObject({ kind: "busy" })
    expect(database.prepare("SELECT asset_bytes FROM user_usage").get()).toEqual({ asset_bytes: MiB })
  })
  it("recovers a confirmed delete without releasing its quota twice", async () => {
    const { env, database, bucket } = createEnv()
    seed(database, bucket)
    bucket.failAfterDelete = true
    await expect(deleteAsset(env, "user-1", "existing")).resolves.toMatchObject({ kind: "unknown" })
    expect(database.prepare("SELECT asset_bytes FROM user_usage").get()).toEqual({ asset_bytes: 50 * MiB })
    await reconcileAssetOperations(env)
    await reconcileAssetOperations(env)
    expect(database.prepare("SELECT asset_bytes FROM user_usage").get()).toEqual({ asset_bytes: 45 * MiB })
  })
  it("recovers after R2 succeeded but D1 settlement failed", async () => {
    const { env, database } = createEnv()
    database.exec("CREATE TRIGGER fail_commit BEFORE UPDATE OF state ON asset_operations WHEN NEW.state = 'committed' BEGIN SELECT RAISE(ABORT, 'failed settlement'); END")
    await expect(putAsset(env, "user-1", "a", bytes(MiB), "image/png")).resolves.toMatchObject({ kind: "unknown" })
    database.exec("DROP TRIGGER fail_commit")
    await reconcileAssetOperations(env)
    expect(database.prepare("SELECT asset_bytes FROM user_usage").get()).toEqual({ asset_bytes: MiB })
    expect(database.prepare("SELECT state FROM asset_operations").get()).toEqual({ state: "committed" })
  })
})
