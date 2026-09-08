const SESSION_COOKIE = "__Host-memento_session"
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const SYNC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_INVITED_USERS = 150

import {
  MAX_SYNC_RECORD_BYTES,
  SYNC_BATCH_SIZE,
  SYNC_PULL_SIZE,
  shouldApplyRecord,
  syncEntitySchema,
  type SyncEntity,
  validSyncWriteTime,
} from "../src/domain/syncProtocol"
import {
  assetKey,
  deleteAsset,
  imageSignature,
  isValidAssetId,
  MAX_ASSET_BYTES,
  putAsset as putAssetObject,
} from "./assets"

export type AuthUser = { id: string; username: string }

type SessionRow = AuthUser & { expires_at: number }
type UserRow = AuthUser & { password_salt: string; password_hash: string; disabled_at: number | null }
type InviteRow = { id: string }
type EntityRow = { entity_type: string; entity_id: string; revision: number; updated_at: number; deleted_at: number | null; payload: string }
type ChangeRow = EntityRow & { cursor: number; operation: "put" | "delete"; changed_at: number }

export function shouldAcceptSyncChange(
  current: Pick<EntityRow, "revision" | "updated_at"> | null,
  incoming: { revision: number; changedAt: number },
): boolean {
  return shouldApplyRecord(current && { revision: current.revision, updatedAt: current.updated_at }, { revision: incoming.revision, updatedAt: incoming.changedAt })
}

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: message, code }, { status, headers: { "Cache-Control": "no-store" } })
}

function noStoreJson(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set("Cache-Control", "no-store")
  return Response.json(value, { ...init, headers })
}

function cookieValue(request: Request, name: string): string | null {
  const value = request.headers.get("cookie") ?? ""
  return value.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null
}

function base64(bytes: Uint8Array): string {
  let text = ""
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

function fromBase64(value: string): Uint8Array {
  const text = atob(value)
  return Uint8Array.from(text, (character) => character.charCodeAt(0))
}

function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function passwordHash(password: string, salt: Uint8Array, pepper: string): Promise<string> {
  const stableSalt = new Uint8Array(salt.byteLength)
  stableSalt.set(salt)
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${password}\u0000${pepper}`), "PBKDF2", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: stableSalt, iterations: 60_000 }, material, 256)
  return base64(new Uint8Array(bits))
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  let difference = leftBytes.byteLength ^ rightBytes.byteLength
  for (let index = 0; index < Math.max(leftBytes.byteLength, rightBytes.byteLength); index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalized) ? normalized : null
}

function passwordInput(value: unknown): string | null {
  return typeof value === "string" && value.length >= 12 && value.length <= 128 ? value : null
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null
  const value: unknown = await request.json().catch(() => null)
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function checkWriteOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin")
  if (origin && origin !== new URL(request.url).origin) return error(403, "INVALID_ORIGIN", "请求来源无效。")
  return null
}

async function createSession(env: Env, userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  await env.MEMENTO_DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(`${env.APP_SECRET}\u0000${token}`), userId, Date.now(), expiresAt).run()
  return { token, expiresAt }
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}

export async function authenticate(request: Request, env: Env): Promise<AuthUser | null> {
  const token = cookieValue(request, SESSION_COOKIE)
  if (!token) return null
  const row = await env.MEMENTO_DB.prepare(
    "SELECT users.id, users.username, sessions.expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.disabled_at IS NULL",
  ).bind(await sha256(`${env.APP_SECRET}\u0000${token}`), Date.now()).first<SessionRow>()
  return row ? { id: row.id, username: row.username } : null
}

async function authenticateOrError(request: Request, env: Env): Promise<AuthUser | Response> {
  return await authenticate(request, env) ?? error(401, "AUTHENTICATION_REQUIRED", "请先登录。")
}

async function rateLimitAuth(request: Request, env: Env): Promise<Response | null> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "missing"
  const key = await sha256(`${env.APP_SECRET}\u0000${ip}\u0000${new URL(request.url).pathname}`)
  const result = await env.AUTH_RATE_LIMITER.limit({ key })
  return result.success ? null : error(429, "AUTH_RATE_LIMITED", "尝试次数过多，请稍后再试。")
}

async function register(request: Request, env: Env): Promise<Response> {
  const originFailure = checkWriteOrigin(request)
  if (originFailure) return originFailure
  const limited = await rateLimitAuth(request, env)
  if (limited) return limited
  const input = await readJson(request)
  const username = normalizeUsername(input?.username)
  const password = passwordInput(input?.password)
  const inviteCode = typeof input?.inviteCode === "string" ? input.inviteCode.trim().toUpperCase() : ""
  if (!username || !password || !inviteCode) return error(400, "INVALID_REGISTRATION", "请使用有效的邀请码、用户名和至少 12 位密码。")

  const now = Date.now()
  const invite = await env.MEMENTO_DB.prepare(
    "SELECT id FROM invite_codes WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
  ).bind(await sha256(`${env.APP_SECRET}\u0000${inviteCode}`), now).first<InviteRow>()
  if (!invite) return error(400, "INVALID_INVITE", "邀请码无效或已使用。")

  const existing = await env.MEMENTO_DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first<{ id: string }>()
  if (existing) return error(409, "USERNAME_TAKEN", "该用户名已被使用。")
  const userCount = await env.MEMENTO_DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>()
  if ((userCount?.count ?? 0) >= MAX_INVITED_USERS) return error(403, "INVITE_CAP_REACHED", "当前内测名额已满。")

  const userId = crypto.randomUUID()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await passwordHash(password, salt, env.APP_SECRET)
  const consumed = await env.MEMENTO_DB.prepare("UPDATE invite_codes SET used_by_user_id = ?, used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(userId, now, invite.id).run()
  if (!consumed.meta.changes) return error(400, "INVALID_INVITE", "邀请码无效或已使用。")
  try {
    await env.MEMENTO_DB.batch([
      env.MEMENTO_DB.prepare("INSERT INTO users (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").bind(userId, username, base64(salt), hash, now),
      env.MEMENTO_DB.prepare("INSERT INTO user_usage (user_id, asset_bytes, updated_at) VALUES (?, 0, ?)").bind(userId, now),
    ])
  } catch (cause) {
    await env.MEMENTO_DB.prepare("UPDATE invite_codes SET used_by_user_id = NULL, used_at = NULL WHERE id = ? AND used_by_user_id = ?").bind(invite.id, userId).run()
    throw cause
  }
  const session = await createSession(env, userId)
  return noStoreJson({ user: { id: userId, username }, expiresAt: session.expiresAt }, { status: 201, headers: { "Set-Cookie": sessionCookie(session.token) } })
}

async function login(request: Request, env: Env): Promise<Response> {
  const originFailure = checkWriteOrigin(request)
  if (originFailure) return originFailure
  const limited = await rateLimitAuth(request, env)
  if (limited) return limited
  const input = await readJson(request)
  const username = normalizeUsername(input?.username)
  const password = passwordInput(input?.password)
  if (!username || !password) return error(401, "INVALID_CREDENTIALS", "用户名或密码不正确。")
  const user = await env.MEMENTO_DB.prepare("SELECT id, username, password_salt, password_hash, disabled_at FROM users WHERE username = ?").bind(username).first<UserRow>()
  if (user?.disabled_at !== null) {
    return error(401, "INVALID_CREDENTIALS", "用户名或密码不正确。")
  }
  if (!secureEqual(await passwordHash(password, fromBase64(user.password_salt), env.APP_SECRET), user.password_hash)) {
    return error(401, "INVALID_CREDENTIALS", "用户名或密码不正确。")
  }
  const session = await createSession(env, user.id)
  return noStoreJson({ user: { id: user.id, username: user.username }, expiresAt: session.expiresAt }, { headers: { "Set-Cookie": sessionCookie(session.token) } })
}

async function logout(request: Request, env: Env): Promise<Response> {
  const originFailure = checkWriteOrigin(request)
  if (originFailure) return originFailure
  const token = cookieValue(request, SESSION_COOKIE)
  if (token) await env.MEMENTO_DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(`${env.APP_SECRET}\u0000${token}`)).run()
  return noStoreJson({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } })
}

function serializeEntity(row: EntityRow): Record<string, unknown> {
  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    revision: row.revision,
    updatedAt: row.updated_at,
    operation: row.deleted_at === null ? "put" : "delete",
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }
}

function parseChange(value: unknown, now: number): SyncEntity | null {
  const result = syncEntitySchema.safeParse(value)
  if (!result.success || !validSyncWriteTime(result.data.updatedAt, now)) return null
  return result.data
}

async function pushSync(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const originFailure = checkWriteOrigin(request)
  if (originFailure) return originFailure
  const input = await readJson(request)
  if (!Array.isArray(input?.changes) || input.changes.length > SYNC_BATCH_SIZE) return error(400, "INVALID_SYNC_BATCH", "同步批次无效。")
  const accepted: string[] = []
  const now = Date.now()
  const entities = new Map<string, SyncEntity>()
  for (const rawChange of input.changes) {
    const change = parseChange(rawChange, now)
    if (!change) return error(400, "INVALID_SYNC_CHANGE", "同步记录无效。")
    if (change.entityType === "asset" && change.operation === "put") {
      const object = await env.MEMENTO_ASSETS.head(assetKey(user.id, change.entityId))
      const storedRevision = object?.customMetadata?.revision
      const storedUpdatedAt = object?.customMetadata?.updatedAt
      if (storedRevision !== undefined && storedUpdatedAt !== undefined
        && (Number(storedRevision) !== change.revision || Number(storedUpdatedAt) !== change.updatedAt)) {
        return error(409, "ASSET_VERSION_CONFLICT", "图片内容与同步记录版本不一致，请重新同步。")
      }
    }
    const payload = JSON.stringify(change.payload)
    if (new TextEncoder().encode(payload).byteLength > MAX_SYNC_RECORD_BYTES) return error(413, "SYNC_RECORD_TOO_LARGE", "单条手帐记录不能超过 512 KiB。")
    // The second statement is conditional on the first statement's change
    // count. D1 batches execute sequentially in one transaction, so an entity
    // write and its change-log row either commit together or roll back.
    const writes = await env.MEMENTO_DB.batch([
      env.MEMENTO_DB.prepare(
        "INSERT INTO sync_entities (user_id, entity_type, entity_id, revision, updated_at, deleted_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, payload = excluded.payload WHERE excluded.updated_at > sync_entities.updated_at OR (excluded.updated_at = sync_entities.updated_at AND excluded.revision > sync_entities.revision)",
      ).bind(user.id, change.entityType, change.entityId, change.revision, change.updatedAt, change.operation === "delete" ? change.updatedAt : null, payload),
      env.MEMENTO_DB.prepare(
        "INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, operation, changed_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0",
      ).bind(user.id, change.entityType, change.entityId, change.revision, change.operation, now),
    ])
    const applied = (writes[0]?.meta.changes ?? 0) > 0
    const row = await env.MEMENTO_DB.prepare(
      "SELECT entity_type, entity_id, revision, updated_at, deleted_at, payload FROM sync_entities WHERE user_id = ? AND entity_type = ? AND entity_id = ?",
    ).bind(user.id, change.entityType, change.entityId).first<EntityRow>()
    if (!row) return error(500, "SYNC_ENTITY_MISSING", "同步记录提交后无法读取。")
    const finalEntity = syncEntitySchema.parse({
      entityType: row.entity_type,
      entityId: row.entity_id,
      revision: row.revision,
      updatedAt: row.updated_at,
      operation: row.deleted_at === null ? "put" : "delete",
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    })
    accepted.push(`${change.entityType}:${change.entityId}`)
    entities.set(`${change.entityType}:${change.entityId}`, finalEntity)
    if (change.entityType === "asset" && change.operation === "delete" && finalEntity.operation === "delete" && (applied || row.deleted_at !== null)) {
      const deletion = await deleteAsset(env, user.id, change.entityId)
      if (deletion.kind === "busy") return error(409, "ASSET_OPERATION_BUSY", "该贴纸正在进行其他存储操作，请稍后重试。")
      if (deletion.kind === "unknown") return error(503, "ASSET_OPERATION_UNKNOWN", "贴纸删除结果待确认，请稍后重试。")
      if (deletion.kind === "quota") return error(409, "ASSET_USAGE_RECONCILIATION_REQUIRED", "贴纸存储用量需要核对后才能删除。")
    }
  }
  await env.MEMENTO_DB.prepare("DELETE FROM sync_changes WHERE changed_at < ?").bind(now - SYNC_RETENTION_MS).run()
  const cursorRow = await env.MEMENTO_DB.prepare("SELECT COALESCE(MAX(cursor), 0) AS cursor FROM sync_changes WHERE user_id = ?").bind(user.id).first<{ cursor: number }>()
  return noStoreJson({ accepted, cursor: cursorRow?.cursor ?? 0, entities: [...entities.values()] })
}

async function syncSnapshot(env: Env, user: AuthUser): Promise<Response> {
  // Keep the entity rows and cursor in one SQLite statement. A concurrent
  // write is therefore either wholly before or wholly after this snapshot.
  const rows = await env.MEMENTO_DB.prepare(
    "SELECT snapshot.snapshot_cursor, entities.entity_type, entities.entity_id, entities.revision, entities.updated_at, entities.deleted_at, entities.payload FROM (SELECT COALESCE(MAX(cursor), 0) AS snapshot_cursor FROM sync_changes WHERE user_id = ?) AS snapshot LEFT JOIN sync_entities AS entities ON entities.user_id = ? ORDER BY entities.updated_at, entities.entity_id",
  ).bind(user.id, user.id).all<EntityRow & { snapshot_cursor: number; entity_type: string | null; entity_id: string | null; revision: number | null; updated_at: number | null; deleted_at: number | null; payload: string | null }>()
  const cursor = rows.results[0]?.snapshot_cursor ?? 0
  const entities = rows.results.flatMap((row) => row.entity_type && row.entity_id && row.revision !== null && row.updated_at !== null && row.deleted_at !== undefined && row.payload !== null
    ? [serializeEntity({ entity_type: row.entity_type, entity_id: row.entity_id, revision: row.revision, updated_at: row.updated_at, deleted_at: row.deleted_at, payload: row.payload })]
    : [])
  return noStoreJson({ cursor, entities })
}

async function pullSync(url: URL, env: Env, user: AuthUser): Promise<Response> {
  const cursor = Number(url.searchParams.get("cursor") ?? "0")
  if (!Number.isSafeInteger(cursor) || cursor < 0) return error(400, "INVALID_CURSOR", "同步游标无效。")
  const earliest = await env.MEMENTO_DB.prepare("SELECT MIN(cursor) AS cursor FROM sync_changes WHERE user_id = ?").bind(user.id).first<{ cursor: number | null }>()
  const earliestCursor = earliest?.cursor
  if (cursor > 0 && earliestCursor !== undefined && earliestCursor !== null && cursor < earliestCursor - 1) return error(409, "SYNC_CURSOR_EXPIRED", "同步游标已过期，请恢复完整数据。")
  const changes = await env.MEMENTO_DB.prepare(
    "SELECT sync_changes.cursor, sync_changes.entity_type, sync_changes.entity_id, sync_entities.revision, sync_changes.operation, sync_changes.changed_at, sync_entities.updated_at, sync_entities.deleted_at, sync_entities.payload FROM sync_changes JOIN sync_entities ON sync_entities.user_id = sync_changes.user_id AND sync_entities.entity_type = sync_changes.entity_type AND sync_entities.entity_id = sync_changes.entity_id WHERE sync_changes.user_id = ? AND sync_changes.cursor > ? ORDER BY sync_changes.cursor LIMIT ?",
  ).bind(user.id, cursor, SYNC_PULL_SIZE + 1).all<ChangeRow>()
  const hasMore = changes.results.length > SYNC_PULL_SIZE
  const page = hasMore ? changes.results.slice(0, SYNC_PULL_SIZE) : changes.results
  const nextCursor = page.at(-1)?.cursor ?? cursor
  return noStoreJson({ cursor: nextCursor, entities: page.map(serializeEntity), hasMore })
}

async function putAsset(request: Request, env: Env, user: AuthUser, assetId: string): Promise<Response> {
  const originFailure = checkWriteOrigin(request)
  if (originFailure) return originFailure
  if (!isValidAssetId(assetId)) return error(400, "INVALID_ASSET_ID", "图片标识无效。")
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? ""
  if (contentType !== "image/png" && contentType !== "image/webp" && contentType !== "image/jpeg") return error(415, "UNSUPPORTED_ASSET_TYPE", "仅支持 JPEG、PNG 或 WebP 图片。")
  const contentLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > MAX_ASSET_BYTES) return error(413, "ASSET_TOO_LARGE", "单张贴纸不能超过 6 MiB。")
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (!bytes.byteLength || bytes.byteLength > MAX_ASSET_BYTES || !imageSignature(bytes, contentType)) return error(415, "INVALID_ASSET", "贴纸文件无效。")
  const revisionHeader = request.headers.get("X-Asset-Revision")
  const updatedAtHeader = request.headers.get("X-Asset-Updated-At")
  const version = revisionHeader === null && updatedAtHeader === null ? undefined : { revision: Number(revisionHeader), updatedAt: Number(updatedAtHeader) }
  if (version && (revisionHeader === null || updatedAtHeader === null || !Number.isSafeInteger(version.revision) || version.revision < 0 || !validSyncWriteTime(version.updatedAt))) return error(400, "INVALID_ASSET_VERSION", "图片版本无效。")
  const result = await putAssetObject(env, user.id, assetId, bytes, contentType, version)
  if (result.kind === "quota") return error(413, "ASSET_QUOTA_EXCEEDED", "该账号的贴纸存储空间已满。")
  if (result.kind === "busy") return error(409, "ASSET_OPERATION_BUSY", "该贴纸正在进行其他存储操作，请稍后重试。")
  if (result.kind === "conflict") return error(409, "ASSET_WRITE_CONFLICT", "该贴纸刚刚发生了更新，请重新上传。")
  if (result.kind === "unknown") return error(503, "ASSET_OPERATION_UNKNOWN", "贴纸上传结果待确认，请稍后重试。")
  return noStoreJson({ remoteKey: result.remoteKey, bytes: result.bytes, mimeType: result.mimeType }, { status: 201 })
}

async function getAsset(env: Env, user: AuthUser, assetId: string): Promise<Response> {
  if (!isValidAssetId(assetId)) return error(400, "INVALID_ASSET_ID", "图片标识无效。")
  const object = await env.MEMENTO_ASSETS.get(assetKey(user.id, assetId))
  if (!object) return error(404, "ASSET_NOT_FOUND", "找不到该贴纸。")
  const headers = new Headers({ "Cache-Control": "private, no-store", "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream" })
  return new Response(object.body, { headers })
}

export async function handleMementoApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname === "/api/auth/register" && request.method === "POST") return register(request, env)
  if (url.pathname === "/api/auth/login" && request.method === "POST") return login(request, env)
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env)
  if (url.pathname === "/api/auth/session" && request.method === "GET") {
    const user = await authenticate(request, env)
    return noStoreJson({ user })
  }
  if (!url.pathname.startsWith("/api/sync") && !url.pathname.startsWith("/api/assets/")) return null
  const user = await authenticateOrError(request, env)
  if (user instanceof Response) return user
  if (url.pathname === "/api/sync/snapshot" && request.method === "GET") return syncSnapshot(env, user)
  if (url.pathname === "/api/sync/pull" && request.method === "GET") return pullSync(url, env, user)
  if (url.pathname === "/api/sync/push" && request.method === "POST") return pushSync(request, env, user)
  const assetId = /^\/api\/assets\/([^/]+)$/.exec(url.pathname)?.[1]
  if (assetId && request.method === "PUT") return putAsset(request, env, user, assetId)
  if (assetId && request.method === "GET") return getAsset(env, user, assetId)
  return error(404, "API_NOT_FOUND", "接口不存在。")
}
