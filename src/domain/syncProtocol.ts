import { z } from "zod";
import { assetRecordSchema, journalPageRecordSchema, journalRecordSchema, stickerRecordSchema } from "./model";

export const SYNC_BATCH_SIZE = 50;
export const SYNC_PULL_SIZE = 100;
export const MAX_SYNC_RECORD_BYTES = 512 * 1024;
export const syncEntityTypeSchema = z.enum(["asset", "sticker", "journal", "journalPage"]);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const recordSchemas = { asset: assetRecordSchema, sticker: stickerRecordSchema, journal: journalRecordSchema, journalPage: journalPageRecordSchema };

/** One wire format for browser and Worker. changedAt is read-only legacy compatibility. */
export const syncEntitySchema = z.object({
  entityType: syncEntityTypeSchema,
  entityId: z.string().min(1).max(200),
  operation: z.enum(["put", "delete"]),
  revision: timestamp,
  updatedAt: timestamp.optional(),
  changedAt: timestamp.optional(),
  payload: z.record(z.string(), z.unknown()),
}).transform((input, context) => {
  const updatedAt = input.updatedAt ?? input.changedAt;
  if (updatedAt === undefined) {
    context.addIssue({ code: "custom", message: "Missing sync timestamp" });
    return z.NEVER;
  }
  if (input.entityId !== input.payload.id) {
    context.addIssue({ code: "custom", message: "Entity and payload IDs must match" });
    return z.NEVER;
  }
  const payload = { ...input.payload, revision: input.revision, updatedAt,
    ...(input.operation === "delete" ? { deletedAt: updatedAt } : {}) };
  const parsed = recordSchemas[input.entityType].safeParse(payload);
  if (!parsed.success || (input.operation === "put" && parsed.data.deletedAt !== undefined)) {
    context.addIssue({ code: "custom", message: "Invalid sync record" });
    return z.NEVER;
  }
  const normalizedPayload: Record<string, unknown> = parsed.data;
  return { entityType: input.entityType, entityId: input.entityId, operation: input.operation,
    revision: input.revision, updatedAt, payload: normalizedPayload };
});

export type SyncEntity = z.infer<typeof syncEntitySchema>;
export type SyncEntityType = z.infer<typeof syncEntityTypeSchema>;
export const syncPullSchema = z.object({ cursor: timestamp, entities: z.array(syncEntitySchema), hasMore: z.boolean().optional() });
export const syncPushSchema = z.object({ cursor: timestamp, accepted: z.array(z.string()), entities: z.array(syncEntitySchema).optional() });

export function shouldApplyRecord(
  current: { revision: number; updatedAt: number } | null | undefined,
  incoming: { revision: number; updatedAt: number },
): boolean {
  return !current || incoming.updatedAt > current.updatedAt
    || (incoming.updatedAt === current.updatedAt && incoming.revision > current.revision);
}

export function validSyncWriteTime(updatedAt: number, now = Date.now()): boolean {
  return Number.isSafeInteger(updatedAt) && updatedAt >= 0 && updatedAt <= now + 5 * 60_000;
}
