import { z } from "zod";

export const stickerFinishSchema = z.enum(["edge-soft", "edge-bold", "edge-lift"]);
export const stickerBorderSchema = z.enum(["sticker-clean", "sticker-torn", "sticker-polaroid"]);
export const journalCoverSchema = z.enum(["cover-blue", "cover-rose", "cover-sun", "cover-cocoa"]);
export const journalPaperSchema = z.enum([
  "paper-grid",
  "paper-plain",
  "paper-lined",
  "paper-calendar",
  "paper-ledger",
  "paper-sprinkle"
]);

export const baseRecordSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().optional()
});

export const assetRecordSchema = baseRecordSchema.extend({
  mimeType: z.string().min(1),
  blob: z.instanceof(Blob).optional(),
  url: z.string().optional(),
  remoteKey: z.string().optional()
}).refine((asset) => Boolean(asset.blob ?? asset.url), "An asset needs a local blob or URL.");

export const stickerRecordSchema = baseRecordSchema.extend({
  name: z.string().min(1).max(36),
  group: z.string().min(1).max(48),
  assetId: z.string().min(1),
  finish: stickerFinishSchema,
  edgeThickness: z.number().min(1).max(10),
  border: stickerBorderSchema,
  tilt: z.number().min(-30).max(30)
});

export const placementSchema = z.object({
  id: z.string().min(1),
  left: z.number(),
  top: z.number(),
  angle: z.number(),
  scale: z.number().min(0.2).max(4),
  zIndex: z.number().int().nonnegative()
});

export const pageWordsSchema = z.object({
  headline: z.string().max(80),
  note: z.string().max(90)
});

export const pageHistorySchema = z.object({
  entries: z.array(z.array(placementSchema)).max(30),
  index: z.number().int()
});

export const journalRecordSchema = baseRecordSchema.extend({
  title: z.string().min(1).max(32),
  year: z.string().min(1).max(40),
  pages: z.number().int().positive(),
  currentPage: z.number().int().positive(),
  cover: journalCoverSchema,
  paper: journalPaperSchema
});

export const journalPageRecordSchema = baseRecordSchema.extend({
  journalId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  words: pageWordsSchema,
  placements: z.array(placementSchema),
  history: pageHistorySchema
});

export const settingsRecordSchema = z.object({
  id: z.literal("app"),
  schemaVersion: z.literal(2),
  legacyMigrationComplete: z.boolean(),
  crossOriginMigrationDismissed: z.boolean(),
  updatedAt: z.number().int().nonnegative()
});

export const changeRecordSchema = z.object({
  sequence: z.number().int().positive().optional(),
  entityType: z.enum(["journal", "journalPage", "sticker", "asset", "settings"]),
  entityId: z.string().min(1),
  operation: z.enum(["put", "delete"]),
  revision: z.number().int().nonnegative(),
  changedAt: z.number().int().nonnegative()
});

export type AssetRecord = z.infer<typeof assetRecordSchema>;
export type StickerRecord = z.infer<typeof stickerRecordSchema>;
export type StickerFinish = z.infer<typeof stickerFinishSchema>;
export type StickerBorder = z.infer<typeof stickerBorderSchema>;
export type JournalCover = z.infer<typeof journalCoverSchema>;
export type JournalPaper = z.infer<typeof journalPaperSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type PageWords = z.infer<typeof pageWordsSchema>;
export type PageHistory = z.infer<typeof pageHistorySchema>;
export type JournalRecord = z.infer<typeof journalRecordSchema>;
export type JournalPageRecord = z.infer<typeof journalPageRecordSchema>;
export type SettingsRecord = z.infer<typeof settingsRecordSchema>;
export type ChangeRecord = z.infer<typeof changeRecordSchema>;

export interface AppSnapshot {
  assets: AssetRecord[];
  stickers: StickerRecord[];
  journals: JournalRecord[];
  journalPages: JournalPageRecord[];
  settings: SettingsRecord;
}
