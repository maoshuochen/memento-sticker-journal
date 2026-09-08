import { shouldApplyRecord } from "../src/domain/syncProtocol"

export const MAX_ASSET_BYTES = 6 * 1024 * 1024
export const MAX_ACCOUNT_ASSET_BYTES = 50 * 1024 * 1024

type AssetOperation = {
  id: string
  user_id: string
  asset_id: string
  operation: "put" | "delete"
  state: "reserved" | "unknown" | "committed" | "failed"
  old_bytes: number
  new_bytes: number
  delta_bytes: number
  reserved_bytes: number
  old_etag: string | null
  content_hash: string | null
  mime_type: string | null
  quota_released: number
  error_code: string | null
}

export type AssetOperationOutcome =
  | { kind: "committed"; remoteKey: string; bytes: number; mimeType: string }
  | { kind: "quota" }
  | { kind: "busy" }
  | { kind: "conflict" }
  | { kind: "unknown" }

export function assetKey(userId: string, assetId: string): string {
  return `users/${userId}/assets/${assetId}`
}

export function isValidAssetId(assetId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(assetId)
}

export function imageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/png") return bytes.byteLength >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
  if (mimeType === "image/jpeg") return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  return mimeType === "image/webp" && bytes.byteLength >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await digestBytes(bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function digestBytes(bytes: Uint8Array): Promise<ArrayBuffer> {
  return await crypto.subtle.digest("SHA-256", bytesBuffer(bytes))
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function isActive(operation: AssetOperation): boolean {
  return operation.state === "reserved" || operation.state === "unknown"
}

async function findActiveOperation(env: Env, userId: string, assetId: string): Promise<AssetOperation | null> {
  return await env.MEMENTO_DB.prepare(
    "SELECT id, user_id, asset_id, operation, state, old_bytes, new_bytes, delta_bytes, reserved_bytes, old_etag, content_hash, mime_type, quota_released, error_code FROM asset_operations WHERE user_id = ? AND asset_id = ? AND state IN ('reserved', 'unknown') ORDER BY created_at DESC LIMIT 1",
  ).bind(userId, assetId).first<AssetOperation>()
}

async function releaseReservation(env: Env, operationId: string, now = Date.now()): Promise<void> {
  // D1 batch statements run sequentially inside one transaction. The
  // quota_released guard makes compensation idempotent if a retry follows an
  // uncertain response.
  await env.MEMENTO_DB.batch([
    env.MEMENTO_DB.prepare(
      "UPDATE user_usage SET asset_bytes = asset_bytes - (SELECT reserved_bytes FROM asset_operations WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0), updated_at = ? WHERE user_id = (SELECT user_id FROM asset_operations WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0)",
    ).bind(operationId, now, operationId),
    env.MEMENTO_DB.prepare(
      "UPDATE asset_operations SET state = 'failed', active_key = NULL, quota_released = 1, error_code = ?, updated_at = ? WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0 AND changes() > 0",
    ).bind("R2_CONDITION_FAILED", now, operationId),
  ])
}

async function markUnknown(env: Env, operationId: string, code: string, now = Date.now()): Promise<void> {
  await env.MEMENTO_DB.prepare(
    "UPDATE asset_operations SET state = 'unknown', error_code = ?, updated_at = ? WHERE id = ? AND state = 'reserved'",
  ).bind(code, now, operationId).run()
}

async function commitPut(
  env: Env,
  operation: AssetOperation,
  object: R2Object,
  mimeType: string,
  contentHash: string,
  now = Date.now(),
): Promise<void> {
  const results = await env.MEMENTO_DB.batch([
    env.MEMENTO_DB.prepare(
      "UPDATE user_usage SET asset_bytes = asset_bytes + (SELECT delta_bytes - reserved_bytes FROM asset_operations WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0), updated_at = ? WHERE user_id = (SELECT user_id FROM asset_operations WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0) AND asset_bytes + (SELECT delta_bytes - reserved_bytes FROM asset_operations WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0) >= 0",
    ).bind(operation.id, now, operation.id, operation.id),
    env.MEMENTO_DB.prepare(
      "UPDATE asset_operations SET state = 'committed', active_key = NULL, quota_released = 1, updated_at = ? WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0 AND changes() > 0",
    ).bind(now, operation.id),
    env.MEMENTO_DB.prepare(
      "INSERT INTO asset_records (user_id, asset_id, byte_size, mime_type, etag, content_hash, updated_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0 ON CONFLICT(user_id, asset_id) DO UPDATE SET byte_size = excluded.byte_size, mime_type = excluded.mime_type, etag = excluded.etag, content_hash = excluded.content_hash, updated_at = excluded.updated_at",
    ).bind(operation.user_id, operation.asset_id, object.size, mimeType, object.etag, contentHash, now),
  ])
  if ((results[1]?.meta.changes ?? 0) !== 1) {
    const final = await env.MEMENTO_DB.prepare("SELECT state FROM asset_operations WHERE id = ?").bind(operation.id).first<{ state: string }>()
    if (final?.state !== "committed") throw new Error("asset operation was not active")
  }
}

async function commitDelete(env: Env, operation: AssetOperation, now = Date.now()): Promise<void> {
  const results = await env.MEMENTO_DB.batch([
    env.MEMENTO_DB.prepare(
      "UPDATE user_usage SET asset_bytes = asset_bytes + (SELECT delta_bytes - reserved_bytes FROM asset_operations WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0), updated_at = ? WHERE user_id = (SELECT user_id FROM asset_operations WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0) AND asset_bytes + (SELECT delta_bytes - reserved_bytes FROM asset_operations WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0) >= 0",
    ).bind(operation.id, now, operation.id, operation.id),
    env.MEMENTO_DB.prepare(
      "UPDATE asset_operations SET state = 'committed', active_key = NULL, quota_released = 1, updated_at = ? WHERE id = ? AND state IN ('reserved', 'unknown') AND quota_released = 0 AND changes() > 0",
    ).bind(now, operation.id),
    env.MEMENTO_DB.prepare(
      "DELETE FROM asset_records WHERE user_id = ? AND asset_id = ? AND changes() > 0",
    ).bind(operation.user_id, operation.asset_id),
  ])
  if ((results[1]?.meta.changes ?? 0) !== 1) {
    const final = await env.MEMENTO_DB.prepare("SELECT state FROM asset_operations WHERE id = ?").bind(operation.id).first<{ state: string }>()
    if (final?.state !== "committed") throw new Error("asset operation was not active")
  }
}

async function reserveOperation(
  env: Env,
  input: {
    userId: string
    assetId: string
    operation: "put" | "delete"
    oldBytes: number
    newBytes: number
    oldEtag: string | null
    contentHash: string | null
    mimeType: string | null
  },
): Promise<AssetOperation | null> {
  const id = crypto.randomUUID()
  const now = Date.now()
  const activeKey = `${input.userId}:${input.assetId}`
  const delta = input.newBytes - input.oldBytes
  const reservedBytes = Math.max(0, delta)
  const results = await env.MEMENTO_DB.batch([
    env.MEMENTO_DB.prepare(
      "INSERT INTO user_usage (user_id, asset_bytes, updated_at) VALUES (?, 0, ?) ON CONFLICT(user_id) DO NOTHING",
    ).bind(input.userId, now),
    env.MEMENTO_DB.prepare(
      "UPDATE user_usage SET asset_bytes = asset_bytes + ?, updated_at = ? WHERE user_id = ? AND (asset_bytes + ? <= ? OR ? = 0) AND NOT EXISTS (SELECT 1 FROM asset_operations WHERE user_id = ? AND asset_id = ? AND state IN ('reserved', 'unknown'))",
    ).bind(reservedBytes, now, input.userId, reservedBytes, MAX_ACCOUNT_ASSET_BYTES, reservedBytes, input.userId, input.assetId),
    env.MEMENTO_DB.prepare(
      "INSERT INTO asset_operations (id, user_id, asset_id, operation, state, old_bytes, new_bytes, delta_bytes, reserved_bytes, old_etag, content_hash, mime_type, quota_released, created_at, updated_at, active_key) SELECT ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ? WHERE changes() > 0",
    ).bind(id, input.userId, input.assetId, input.operation, input.oldBytes, input.newBytes, delta, reservedBytes, input.oldEtag, input.contentHash, input.mimeType, now, now, activeKey),
  ])
  if ((results[2]?.meta.changes ?? 0) !== 1) return null
  return {
    id,
    user_id: input.userId,
    asset_id: input.assetId,
    operation: input.operation,
    state: "reserved",
    old_bytes: input.oldBytes,
    new_bytes: input.newBytes,
    delta_bytes: delta,
    reserved_bytes: reservedBytes,
    old_etag: input.oldEtag,
    content_hash: input.contentHash,
    mime_type: input.mimeType,
    quota_released: 0,
    error_code: null,
  }
}

async function recoverActiveOperation(env: Env, userId: string, assetId: string): Promise<"free" | "committed" | "busy"> {
  const operation = await findActiveOperation(env, userId, assetId)
  if (!operation || !isActive(operation)) return "free"
  // Only positive evidence of the intended result can release a lock. The old
  // object still being present is not evidence that an in-flight write failed.
  const object = await env.MEMENTO_ASSETS.head(assetKey(userId, assetId))
  const customMetadata = object?.customMetadata ?? {}
  const matchesPut = operation.operation === "put"
    && customMetadata.operationId === operation.id
    && customMetadata.contentHash === operation.content_hash
  const matchesDelete = operation.operation === "delete" && operation.old_bytes > 0 && !object
  if (matchesPut && object && operation.mime_type && operation.content_hash) {
    await commitPut(env, operation, object, operation.mime_type, operation.content_hash)
    return "committed"
  }
  if (matchesDelete) {
    await commitDelete(env, operation)
    return "committed"
  }
  return "busy"
}

export async function reconcileAssetOperations(env: Env, userId?: string): Promise<number> {
  const query = userId
    ? env.MEMENTO_DB.prepare("SELECT id, user_id, asset_id, operation, state, old_bytes, new_bytes, delta_bytes, reserved_bytes, old_etag, content_hash, mime_type, quota_released, error_code FROM asset_operations WHERE user_id = ? AND state IN ('reserved', 'unknown') ORDER BY created_at").bind(userId)
    : env.MEMENTO_DB.prepare("SELECT id, user_id, asset_id, operation, state, old_bytes, new_bytes, delta_bytes, reserved_bytes, old_etag, content_hash, mime_type, quota_released, error_code FROM asset_operations WHERE state IN ('reserved', 'unknown') ORDER BY created_at")
  const operations = await query.all<AssetOperation>()
  let changed = 0
  for (const operation of operations.results) {
    const result = await recoverActiveOperation(env, operation.user_id, operation.asset_id)
    if (result !== "busy") changed += 1
  }
  return changed
}

async function currentAsset(env: Env, userId: string, assetId: string): Promise<R2Object | null> {
  return await env.MEMENTO_ASSETS.head(assetKey(userId, assetId))
}

export async function putAsset(
  env: Env,
  userId: string,
  assetId: string,
  bytes: Uint8Array,
  mimeType: string,
  version?: { revision: number; updatedAt: number },
): Promise<AssetOperationOutcome> {
  const recovered = await recoverActiveOperation(env, userId, assetId)
  if (recovered === "busy") return { kind: "busy" }
  const existing = await currentAsset(env, userId, assetId)
  const contentHash = await sha256(bytes)
  const operation = await reserveOperation(env, {
    userId,
    assetId,
    operation: "put",
    oldBytes: existing?.size ?? 0,
    newBytes: bytes.byteLength,
    oldEtag: existing?.etag ?? null,
    contentHash,
    mimeType,
  })
  if (!operation) {
    const active = await findActiveOperation(env, userId, assetId)
    return active ? { kind: "busy" } : { kind: "quota" }
  }
  // The reservation serializes byte writes; compare versions while owning it.
  // R2 carries the version even if the later metadata push has not completed.
  const canonical = await env.MEMENTO_DB.prepare("SELECT revision, updated_at AS updatedAt FROM sync_entities WHERE user_id = ? AND entity_type = 'asset' AND entity_id = ?").bind(userId, assetId).first<{ revision: number; updatedAt: number }>()
  const storedVersion = existing?.customMetadata?.updatedAt === undefined ? null : {
    revision: Number(existing.customMetadata.revision), updatedAt: Number(existing.customMetadata.updatedAt),
  }
  const newer = (current: { revision: number; updatedAt: number } | null) => current && (!version || shouldApplyRecord(version, current))
  const differentSameVersion = version !== undefined && storedVersion !== null
    && storedVersion.updatedAt === version.updatedAt
    && storedVersion.revision === version.revision
    && existing?.customMetadata?.contentHash !== contentHash
  if (newer(canonical) || newer(storedVersion) || differentSameVersion) {
    await releaseReservation(env, operation.id)
    return { kind: "conflict" }
  }
  const key = assetKey(userId, assetId)
  const onlyIf: R2Conditional = existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: "*" }
  let object: R2Object | null
  try {
    object = await env.MEMENTO_ASSETS.put(key, bytes, {
      onlyIf,
      httpMetadata: { contentType: mimeType },
      customMetadata: { operationId: operation.id, contentHash, ...(version ? { revision: String(version.revision), updatedAt: String(version.updatedAt) } : {}) },
      sha256: await digestBytes(bytes),
    })
  } catch (cause) {
    await markUnknown(env, operation.id, cause instanceof Error ? "R2_WRITE_UNKNOWN" : "R2_WRITE_ERROR")
    return { kind: "unknown" }
  }
  if (!object) {
    await releaseReservation(env, operation.id)
    return { kind: "conflict" }
  }
  try {
    await commitPut(env, operation, object, mimeType, contentHash)
  } catch {
    await markUnknown(env, operation.id, "D1_COMMIT_UNKNOWN")
    return { kind: "unknown" }
  }
  return { kind: "committed", remoteKey: key, bytes: object.size, mimeType }
}

export async function deleteAsset(env: Env, userId: string, assetId: string): Promise<AssetOperationOutcome> {
  const recovered = await recoverActiveOperation(env, userId, assetId)
  if (recovered === "busy") return { kind: "busy" }
  const existing = await currentAsset(env, userId, assetId)
  const operation = await reserveOperation(env, {
    userId,
    assetId,
    operation: "delete",
    oldBytes: existing?.size ?? 0,
    newBytes: 0,
    oldEtag: existing?.etag ?? null,
    contentHash: null,
    mimeType: null,
  })
  if (!operation) {
    const active = await findActiveOperation(env, userId, assetId)
    return active ? { kind: "busy" } : { kind: "quota" }
  }
  try {
    if (existing) await env.MEMENTO_ASSETS.delete(assetKey(userId, assetId))
  } catch {
    await markUnknown(env, operation.id, "R2_DELETE_UNKNOWN")
    return { kind: "unknown" }
  }
  try {
    await commitDelete(env, operation)
  } catch {
    await markUnknown(env, operation.id, "D1_COMMIT_UNKNOWN")
    return { kind: "unknown" }
  }
  return { kind: "committed", remoteKey: assetKey(userId, assetId), bytes: 0, mimeType: "" }
}
