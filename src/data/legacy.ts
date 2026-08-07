import { z } from "zod";

import {
  assetRecordSchema,
  journalPageRecordSchema,
  journalRecordSchema,
  stickerRecordSchema,
  type AppSnapshot,
  type AssetRecord,
  type JournalPageRecord,
  type JournalRecord,
  type SettingsRecord,
  type StickerRecord
} from "@/domain/model";

const LEGACY_DB_NAME = "memento-journal";
const LEGACY_STORE_NAME = "app-state";
const LEGACY_STORAGE_KEY = "memento-journal-v2";

const legacyPlacementSchema = z.object({
  id: z.string(),
  left: z.number(),
  top: z.number(),
  angle: z.number(),
  scale: z.number(),
  zIndex: z.number()
});

const legacyStickerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  group: z.string().optional(),
  finish: z.string().optional(),
  edgeThickness: z.number().optional(),
  border: z.string().optional(),
  tilt: z.union([z.string(), z.number()]).optional(),
  createdAt: z.number().optional()
});

const legacyHistorySchema = z.object({
  entries: z.array(z.array(legacyPlacementSchema)),
  index: z.number().int()
});

const legacyJournalSchema = z.object({
  id: z.string(),
  title: z.string(),
  year: z.string(),
  pages: z.number().int().positive(),
  page: z.number().int().positive(),
  cover: z.string(),
  paper: z.string(),
  pageContents: z.record(z.string(), z.array(legacyPlacementSchema)).optional(),
  pageWords: z.record(z.string(), z.object({ headline: z.string(), note: z.string() })).optional(),
  history: z.record(z.string(), legacyHistorySchema).optional()
});

export const legacyStateSchema = z.object({
  photos: z.array(legacyStickerSchema),
  journals: z.array(legacyJournalSchema)
});

export type LegacyState = z.infer<typeof legacyStateSchema>;

async function readLegacyIndexedDb(): Promise<unknown> {
  return await new Promise((resolve) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        database.close();
        resolve(null);
        return;
      }
      const transaction = database.transaction(LEGACY_STORE_NAME, "readonly");
      const read = transaction.objectStore(LEGACY_STORE_NAME).get(LEGACY_STORAGE_KEY);
      read.onerror = () => resolve(null);
      read.onsuccess = () => resolve(read.result ?? null);
      transaction.oncomplete = () => database.close();
    };
  });
}

export async function readLegacyState(): Promise<LegacyState | null> {
  const indexedDbState = await readLegacyIndexedDb();
  const indexedDbResult = legacyStateSchema.safeParse(indexedDbState);
  if (indexedDbResult.success) return indexedDbResult.data;

  const localValue = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!localValue) return null;
  try {
    const localResult = legacyStateSchema.safeParse(JSON.parse(localValue));
    return localResult.success ? localResult.data : null;
  } catch {
    return null;
  }
}

async function imageToAsset(sticker: LegacyState["photos"][number], timestamp: number): Promise<AssetRecord> {
  const id = `asset-${sticker.id}`;
  if (sticker.image.startsWith("data:")) {
    try {
      const blob = await (await fetch(sticker.image)).blob();
      return assetRecordSchema.parse({ id, revision: 1, createdAt: timestamp, updatedAt: timestamp, mimeType: blob.type || "image/png", blob });
    } catch {
      // Preserve the original data URL if Blob conversion is unavailable.
    }
  }
  return assetRecordSchema.parse({ id, revision: 1, createdAt: timestamp, updatedAt: timestamp, mimeType: sticker.image.endsWith(".svg") ? "image/svg+xml" : "image/png", url: sticker.image });
}

export async function normalizeLegacyState(state: LegacyState): Promise<Omit<AppSnapshot, "settings"> & { settings: SettingsRecord }> {
  const timestamp = Date.now();
  const assets = await Promise.all(state.photos.map((sticker) => imageToAsset(sticker, sticker.createdAt ?? timestamp)));
  const stickers: StickerRecord[] = state.photos.map((sticker, index) => stickerRecordSchema.parse({
    id: sticker.id,
    revision: 1,
    createdAt: sticker.createdAt ?? timestamp - index,
    updatedAt: timestamp,
    name: sticker.name,
    group: sticker.group ?? "everyday",
    assetId: `asset-${sticker.id}`,
    finish: ["edge-soft", "edge-bold", "edge-lift"].includes(sticker.finish ?? "") ? sticker.finish : "edge-soft",
    edgeThickness: sticker.edgeThickness ?? 3,
    border: ["sticker-clean", "sticker-torn", "sticker-polaroid"].includes(sticker.border ?? "") ? sticker.border : "sticker-clean",
    tilt: Number.parseFloat(String(sticker.tilt ?? 0)) || 0
  }));

  const journals: JournalRecord[] = state.journals.map((journal, index) => journalRecordSchema.parse({
    id: journal.id,
    revision: 1,
    createdAt: timestamp - index,
    updatedAt: timestamp,
    title: journal.title,
    year: journal.year,
    pages: journal.pages,
    currentPage: journal.page,
    cover: journal.cover,
    paper: journal.paper
  }));

  const journalPages: JournalPageRecord[] = state.journals.flatMap((journal) => {
    const pageNumbers = new Set<number>([1]);
    for (let page = 1; page <= journal.pages; page += 1) pageNumbers.add(page);
    return [...pageNumbers].map((pageNumber) => {
      const key = String(pageNumber);
      const placements = journal.pageContents?.[key] ?? [];
      const words = journal.pageWords?.[key] ?? (pageNumber === 1 ? { headline: "soft morning, still warm.", note: "save what made you smile" } : { headline: "", note: "" });
      const history = journal.history?.[key] ?? { entries: [placements], index: 0 };
      return journalPageRecordSchema.parse({
        id: `${journal.id}:${pageNumber}`,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        journalId: journal.id,
        pageNumber,
        words,
        placements,
        history
      });
    });
  });

  return {
    assets,
    stickers,
    journals,
    journalPages,
    settings: {
      id: "app",
      schemaVersion: 2,
      legacyMigrationComplete: true,
      crossOriginMigrationDismissed: false,
      updatedAt: timestamp
    }
  };
}
