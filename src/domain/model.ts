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
  // Source assets are private editable originals. Render assets are the only
  // ones that participate in the regular library, canvas, and export paths.
  // Keep this default so older synced records remain readable.
  role: z.enum(["render", "source"]).default("render"),
  mimeType: z.string().min(1),
  blob: z.instanceof(Blob).optional(),
  url: z.string().optional(),
  remoteKey: z.string().optional()
}).refine((asset) => Boolean(asset.blob ?? asset.url ?? asset.remoteKey), "An asset needs a local blob, URL, or remote key.");

export const stickerRecordSchema = baseRecordSchema.extend({
  name: z.string().min(1).max(36),
  group: z.string().min(1).max(48),
  assetId: z.string().min(1),
  sourceAssetId: z.string().min(1).optional(),
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

export const canvasStickerObjectSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("sticker"),
  stickerId: z.string().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  size: z.number().min(0.04).max(1),
  angle: z.number().min(-360).max(360),
  zIndex: z.number().int().nonnegative()
});

export const canvasTextFontSchema = z.enum(["handwritten", "yozai", "serif", "sans"]);

/**
 * A tape strip has its own normalized geometry rather than borrowing the
 * sticker shape.  Its height is deliberately bounded: users can stretch the
 * strip from either end, but it should continue to read as a piece of tape.
 */
export const canvasTapeObjectSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("tape"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.08).max(0.94),
  height: z.number().min(0.02).max(0.14),
  angle: z.number().min(-360).max(360),
  zIndex: z.number().int().nonnegative()
});

export const canvasTextObjectSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("text"),
  text: z.string().min(1).max(240),
  // Older canvas documents did not persist a text color. Keep this optional
  // for backwards-compatible reads; new/edited text always writes a hex
  // value and the editor falls back to the original ink color when omitted.
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // Like color, this remains optional for journals made before typography
  // choices existed. Those records intentionally retain the original serif
  // appearance until the user changes their font.
  font: canvasTextFontSchema.optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  // Text is a content-sized object rather than a fixed-width writing area.
  // Keep enough range for a single glyph while retaining a safe canvas edge.
  width: z.number().min(0.02).max(0.9),
  fontSize: z.number().min(0.02).max(0.14),
  angle: z.number().min(-360).max(360),
  zIndex: z.number().int().nonnegative()
});

export const canvasObjectSchema = z.discriminatedUnion("kind", [canvasStickerObjectSchema, canvasTapeObjectSchema, canvasTextObjectSchema]);

export const canvasDocumentSchema = z.object({
  version: z.literal(1),
  objects: z.array(canvasObjectSchema).max(300)
});

export const canvasHistorySchema = z.object({
  entries: z.array(canvasDocumentSchema).min(1).max(30),
  index: z.number().int().nonnegative()
});

export const journalRecordSchema = baseRecordSchema.extend({
  title: z.string().min(1).max(32),
  year: z.string().min(1).max(40),
  pages: z.number().int().positive(),
  currentPage: z.number().int().positive(),
  cover: journalCoverSchema,
  paper: journalPaperSchema
});

export const legacyJournalPageRecordSchema = baseRecordSchema.extend({
  journalId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  words: pageWordsSchema,
  placements: z.array(placementSchema),
  history: pageHistorySchema
});

export const canvasJournalPageRecordSchema = baseRecordSchema.extend({
  journalId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  canvasDocument: canvasDocumentSchema,
  history: canvasHistorySchema
});

export const journalPageRecordSchema = z.union([canvasJournalPageRecordSchema, legacyJournalPageRecordSchema]);

export const settingsRecordSchema = z.object({
  id: z.literal("app"),
  schemaVersion: z.literal(2),
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
export type CanvasStickerObject = z.infer<typeof canvasStickerObjectSchema>;
export type CanvasTapeObject = z.infer<typeof canvasTapeObjectSchema>;
export type CanvasTextFont = z.infer<typeof canvasTextFontSchema>;
export type CanvasTextObject = z.infer<typeof canvasTextObjectSchema>;
export type CanvasObject = z.infer<typeof canvasObjectSchema>;
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;
export type CanvasHistory = z.infer<typeof canvasHistorySchema>;
export type LegacyJournalPageRecord = z.infer<typeof legacyJournalPageRecordSchema>;
export type CanvasJournalPageRecord = z.infer<typeof canvasJournalPageRecordSchema>;
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

export function isCanvasJournalPage(page: JournalPageRecord): page is CanvasJournalPageRecord {
  return "canvasDocument" in page;
}
