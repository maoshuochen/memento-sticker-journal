#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

const args = process.argv.slice(2)
const options = new Map()
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === "--json" || arg === "--help") options.set(arg, true)
  else if ((arg === "--database" || arg === "--r2-inventory") && args[i + 1] && !args[i + 1].startsWith("--")) options.set(arg, args[++i])
  else throw new Error(`未知或缺少值的参数: ${arg}`)
}
if (options.has("--help") || !options.has("--database")) {
  console.log("用法: node scripts/reconcile-asset-usage.mjs --database <sqlite-file> [--r2-inventory <json-file>] [--json]")
  console.log("仅以只读方式核对本地数据库副本。R2 清单接受 [{key,size}] 或 {objects:[{key,size}]}；应先合并全部分页。不会联网、修正或执行远程写入。")
  if (!options.has("--help")) process.exitCode = 2
} else {
  const database = new DatabaseSync(options.get("--database"), { readOnly: true })
  try {
    const tableNames = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name))
    for (const name of ["users", "user_usage", "asset_records", "asset_operations"]) {
      if (!tableNames.has(name)) throw new Error("数据库缺少所需表；请在本地副本应用 0001/0002 迁移。")
    }
    let inventory = null
    if (options.has("--r2-inventory")) {
      const input = JSON.parse(readFileSync(options.get("--r2-inventory"), "utf8"))
      const objects = Array.isArray(input) ? input : input.objects
      if (!Array.isArray(objects) || input.truncated === true) throw new Error("R2 清单无效或尚未包含全部分页。")
      inventory = new Map()
      for (const object of objects) {
        if (typeof object.key !== "string" || !Number.isSafeInteger(object.size) || object.size < 0 || inventory.has(object.key)) throw new Error("R2 清单包含无效或重复的对象。")
        inventory.set(object.key, object.size)
      }
    }
    const records = database.prepare("SELECT user_id, asset_id, byte_size FROM asset_records").all()
    const activeOperations = database.prepare("SELECT id, user_id, asset_id, state, operation, old_bytes, new_bytes, reserved_bytes, error_code, updated_at FROM asset_operations WHERE state IN ('reserved', 'unknown') ORDER BY updated_at").all()
    const users = database.prepare("SELECT users.id, users.username, COALESCE(user_usage.asset_bytes, 0) AS recorded_bytes FROM users LEFT JOIN user_usage ON user_usage.user_id = users.id ORDER BY users.id").all()
    const report = users.map((user) => {
      const indexed = records.filter((record) => record.user_id === user.id)
      const pending = activeOperations.filter((operation) => operation.user_id === user.id)
      const prefix = `users/${user.id}/assets/`
      const actual = inventory ? [...inventory].filter(([key]) => key.startsWith(prefix)) : null
      const indexedBytes = indexed.reduce((sum, record) => sum + Number(record.byte_size), 0)
      const reservedBytes = pending.reduce((sum, operation) => sum + Number(operation.reserved_bytes), 0)
      return {
        userId: user.id, username: user.username, recordedBytes: Number(user.recorded_bytes), indexedBytes, reservedBytes,
        indexDifference: indexedBytes + reservedBytes - Number(user.recorded_bytes),
        actualBytes: actual ? actual.reduce((sum, [, size]) => sum + size, 0) : null,
        actualDifference: actual ? actual.reduce((sum, [, size]) => sum + size, 0) - Number(user.recorded_bytes) : null,
        unindexedKeys: actual ? actual.filter(([key]) => !indexed.some((record) => key === prefix + record.asset_id)).map(([key]) => key) : [],
        missingKeys: inventory ? indexed.filter((record) => !inventory.has(prefix + record.asset_id)).map((record) => prefix + record.asset_id) : [],
        activeOperations: pending,
      }
    })
    const knownPrefixes = users.map((user) => `users/${user.id}/assets/`)
    const unmatchedKeys = inventory ? [...inventory.keys()].filter((key) => !knownPrefixes.some((prefix) => key.startsWith(prefix))) : []
    const result = { readOnly: true, verification: inventory ? "r2-inventory-and-index" : "index-only-not-actual-r2-usage", users: report, unmatchedKeys }
    if (options.has("--json")) console.log(JSON.stringify(result, null, 2))
    else {
      console.log(inventory ? "只读核对（数据库副本与完整 R2 清单；请在无并发写入时采集）" : "仅核对 D1 索引，尚未验证实际 R2 用量；存量对象需要完整 R2 清单。")
      for (const user of report) console.log(`${user.username} (${user.userId}) recorded=${user.recordedBytes} indexed=${user.indexedBytes} reserved=${user.reservedBytes} actual=${user.actualBytes ?? "未核对"} unindexed=${user.unindexedKeys.length} missing=${user.missingKeys.length} pending=${user.activeOperations.length}`)
      if (activeOperations.length) console.log("存在未完成操作：不得依据旧对象仍存在就释放额度；只有确认写入结果后才能结算。不确定的操作需人工核对。")
      if (unmatchedKeys.length) console.log(`清单中有 ${unmatchedKeys.length} 个对象不属于当前账号索引。`)
    }
  } finally { database.close() }
}
