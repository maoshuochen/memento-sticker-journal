import type { AssetRecord, CanvasJournalPageRecord, JournalRecord, StickerRecord } from "@/domain/model";

const now = Date.now();

const defaultStickerSeeds = [
  { id: "sample-3", source: "/assets/stickers/strawberry.svg", name: "strawberry", group: "summer 2026", tilt: -2 },
  { id: "sample-4", source: "/assets/stickers/tulip.svg", name: "tulip", group: "summer 2026", tilt: 3 },
  { id: "sample-5", source: "/assets/stickers/croissant.svg", name: "croissant", group: "food + drink", tilt: -7 },
  { id: "sample-6", source: "/assets/stickers/camera.svg", name: "little camera", group: "little finds", tilt: 5 },
  { id: "sample-7", source: "/assets/stickers/cherries.svg", name: "cherries", group: "summer 2026", tilt: 2 },
  { id: "sample-8", source: "/assets/stickers/bear.svg", name: "bear", group: "everyday", tilt: -4 },
  { id: "sample-9", source: "/assets/stickers/plant.svg", name: "plant", group: "little finds", tilt: 7 }
] as const;

const stickerBorders = ["sticker-polaroid", "sticker-torn", "sticker-clean"] as const;
const stickerFinishes = ["edge-soft", "edge-bold", "edge-lift"] as const;

export const defaultAssets: AssetRecord[] = defaultStickerSeeds.map((sticker, index) => ({
  id: `asset-${sticker.id}`,
  revision: 1,
  createdAt: now - index * 86_400_000,
  updatedAt: now - index * 86_400_000,
  role: "render",
  mimeType: sticker.source.endsWith(".svg") ? "image/svg+xml" : "image/png",
  url: sticker.source
}));

export const defaultStickers: StickerRecord[] = defaultStickerSeeds.map((sticker, index) => ({
  id: sticker.id,
  revision: 1,
  createdAt: now - index * 86_400_000,
  updatedAt: now - index * 86_400_000,
  name: sticker.name,
  group: sticker.group,
  assetId: `asset-${sticker.id}`,
  finish: stickerFinishes[index % stickerFinishes.length] ?? "edge-soft",
  edgeThickness: [2, 4, 3][index % 3] ?? 3,
  border: stickerBorders[index % stickerBorders.length] ?? "sticker-clean",
  tilt: sticker.tilt
}));

const journalSeeds = [
  ["journal-1", "Slow Sunday", "July 2026", 5, 1, "cover-blue", "paper-grid"],
  ["journal-2", "Small rituals", "Spring 2026", 8, 3, "cover-cocoa", "paper-plain"],
  ["journal-3", "Out & about", "2025", 12, 7, "cover-sun", "paper-calendar"],
  ["journal-4", "Tender things", "2025", 4, 2, "cover-rose", "paper-grid"]
] as const;

export const defaultJournals: JournalRecord[] = journalSeeds.map(([id, title, year, pages, currentPage, cover, paper], index) => ({
  id,
  revision: 1,
  createdAt: now - index * 86_400_000,
  updatedAt: now - index * 86_400_000,
  title,
  year,
  pages,
  currentPage,
  cover,
  paper
}));

export const defaultJournalPages: CanvasJournalPageRecord[] = defaultJournals.map((journal) => ({
  id: `${journal.id}:1`,
  revision: 1,
  createdAt: journal.createdAt,
  updatedAt: journal.updatedAt,
  journalId: journal.id,
  pageNumber: 1,
  canvasDocument: { version: 1, objects: [] },
  history: { entries: [{ version: 1, objects: [] }], index: 0 }
}));
