import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const script = resolve(process.cwd(), "scripts/create-invite.mjs")

describe("invite:create", () => {
  it("creates the requested batch with a shared expiry in dry-run mode", () => {
    const output = execFileSync(process.execPath, [script, "--count", "3", "--expires", "7d", "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, APP_SECRET: "test-secret" },
    }).trim()

    expect(output).toMatch(/^INSERT INTO invite_codes .* VALUES /)
    const rows = [...output.matchAll(/\('([^']+)', '([0-9a-f]{64})', (\d+), (\d+)\)/g)]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(Number(row[4]) - Number(row[3])).toBe(7 * 24 * 60 * 60 * 1000)
    }
  })
})
