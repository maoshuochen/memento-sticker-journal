import { describe, expect, it } from "vitest";
import { syncEntitySchema, validSyncWriteTime } from "../../src/domain/syncProtocol";
const payload = { id: "j", revision: 1, createdAt: 0, updatedAt: 1000, title: "test", year: "2026", pages: 1, currentPage: 1, cover: "cover-blue", paper: "paper-grid" };
const write = { entityType: "journal", entityId: "j", operation: "put", revision: 1, updatedAt: 1000, payload };
describe("shared sync contract", () => {
  it("accepts the old changedAt alias but emits updatedAt only", () => {
    const parsed = syncEntitySchema.parse({ ...write, updatedAt: undefined, changedAt: 900 });
    expect(parsed.updatedAt).toBe(900);
    expect(parsed.payload.updatedAt).toBe(900);
    expect(parsed).not.toHaveProperty("changedAt");
  });
  it("rejects mismatched IDs, malformed entity payloads and unsafe timestamps", () => {
    expect(syncEntitySchema.safeParse({ ...write, entityId: "other" }).success).toBe(false);
    expect(syncEntitySchema.safeParse({ ...write, entityType: "asset" }).success).toBe(false);
    expect(syncEntitySchema.safeParse({ ...write, updatedAt: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(syncEntitySchema.safeParse({ ...write, payload: { ...payload, pages: 0 } }).success).toBe(false);
  });
  it("normalizes tombstones and rejects puts that contain a deletion", () => {
    expect(syncEntitySchema.parse({ ...write, operation: "delete" }).payload.deletedAt).toBe(1000);
    expect(syncEntitySchema.safeParse({ ...write, payload: { ...payload, deletedAt: 1000 } }).success).toBe(false);
  });
  it("bounds future write timestamps without rejecting old offline edits", () => {
    expect(validSyncWriteTime(0, 1000)).toBe(true);
    expect(validSyncWriteTime(301_001, 1000)).toBe(false);
    expect(validSyncWriteTime(-1, 1000)).toBe(false);
  });
});
