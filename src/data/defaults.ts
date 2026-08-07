import type { AssetRecord, JournalPageRecord, JournalRecord, StickerRecord } from "@/domain/model";

const now = Date.now();

const stickerSources = [
  "/assets/iced-cup-cutout.png",
  "/assets/coffee-cutout.png",
  "/assets/stickers/strawberry.svg",
  "/assets/stickers/tulip.svg",
  "/assets/stickers/croissant.svg",
  "/assets/stickers/camera.svg",
  "/assets/stickers/cherries.svg",
  "/assets/stickers/bear.svg",
  "/assets/stickers/plant.svg"
] as const;

const stickerNames = ["iced cup", "coffee note", "strawberry", "tulip", "croissant", "little camera", "cherries", "bear", "plant"] as const;
const stickerGroups = ["food + drink", "food + drink", "summer 2026", "summer 2026", "food + drink", "little finds", "summer 2026", "everyday", "little finds"] as const;
const stickerBorders = ["sticker-polaroid", "sticker-torn", "sticker-clean"] as const;
const stickerFinishes = ["edge-soft", "edge-bold", "edge-lift"] as const;

export const defaultAssets: AssetRecord[] = stickerSources.map((url, index) => ({
  id: `asset-sample-${index + 1}`,
  revision: 1,
  createdAt: now - index * 86_400_000,
  updatedAt: now - index * 86_400_000,
  mimeType: url.endsWith(".svg") ? "image/svg+xml" : "image/png",
  url
}));

export const defaultStickers: StickerRecord[] = stickerNames.map((name, index) => ({
  id: `sample-${index + 1}`,
  revision: 1,
  createdAt: now - index * 86_400_000,
  updatedAt: now - index * 86_400_000,
  name,
  group: stickerGroups[index] ?? "everyday",
  assetId: `asset-sample-${index + 1}`,
  finish: stickerFinishes[index % stickerFinishes.length] ?? "edge-soft",
  edgeThickness: [2, 4, 3][index % 3] ?? 3,
  border: stickerBorders[index % stickerBorders.length] ?? "sticker-clean",
  tilt: [-5, 6, -2, 3, -7, 5, 2, -4, 7][index] ?? 0
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

export const defaultJournalPages: JournalPageRecord[] = defaultJournals.map((journal) => ({
  id: `${journal.id}:1`,
  revision: 1,
  createdAt: journal.createdAt,
  updatedAt: journal.updatedAt,
  journalId: journal.id,
  pageNumber: 1,
  words: journal.id === "journal-1" ? { headline: "soft morning, still warm.", note: "save what made you smile" } : { headline: "", note: "" },
  placements: journal.id === "journal-1" ? [
    { id: "sample-1", left: 204, top: 125, angle: 8, scale: 1, zIndex: 1 },
    { id: "sample-2", left: 38, top: 247, angle: -8, scale: 1, zIndex: 2 }
  ] : [],
  history: journal.id === "journal-1" ? {
    entries: [[
      { id: "sample-1", left: 204, top: 125, angle: 8, scale: 1, zIndex: 1 },
      { id: "sample-2", left: 38, top: 247, angle: -8, scale: 1, zIndex: 2 }
    ]],
    index: 0
  } : { entries: [[]], index: 0 }
}));
