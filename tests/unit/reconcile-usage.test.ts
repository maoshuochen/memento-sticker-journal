import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("compares a legacy R2 inventory without modifying the local database", () => {
  const directory = mkdtempSync(join(tmpdir(), "memento-usage-"));
  try {
    const path = join(directory, "copy.sqlite");
    const database = new DatabaseSync(path);
    database.exec(readFileSync("migrations/0001_accounts_and_sync.sql", "utf8"));
    database.exec(readFileSync("migrations/0002_asset_operations.sql", "utf8"));
    database.exec("INSERT INTO users VALUES ('u', 'tester', 'test', 'test', 1, NULL); INSERT INTO user_usage VALUES ('u', 10, 1);");
    database.close();
    const before = readFileSync(path);
    const inventory = join(directory, "r2.json");
    writeFileSync(inventory, JSON.stringify({ objects: [{ key: "users/u/assets/legacy", size: 15 }] }));
    const report = JSON.parse(execFileSync(process.execPath, ["scripts/reconcile-asset-usage.mjs", "--database", path, "--r2-inventory", inventory, "--json"], { encoding: "utf8" }));
    expect(report).toMatchObject({ readOnly: true, users: [{ actualBytes: 15, actualDifference: 5, unindexedKeys: ["users/u/assets/legacy"] }] });
    expect(readFileSync(path)).toEqual(before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
