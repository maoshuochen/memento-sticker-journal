import Dexie from "dexie";

import { db } from "@/data/database";
import { defaultAssets, defaultJournalPages, defaultJournals, defaultStickers } from "@/data/defaults";
import { normalizeLegacyState, readLegacyState, type LegacyState } from "@/data/legacy";
import {
  assetRecordSchema,
  journalPageRecordSchema,
  journalRecordSchema,
  settingsRecordSchema,
  stickerRecordSchema,
  type AppSnapshot,
  type AssetRecord,
  type ChangeRecord,
  type JournalPageRecord,
  type JournalRecord,
  type SettingsRecord,
  type StickerRecord
} from "@/domain/model";

const currentSettings = (): SettingsRecord => ({
  id: "app",
  schemaVersion: 2,
  legacyMigrationComplete: true,
  crossOriginMigrationDismissed: false,
  updatedAt: Date.now()
});

function nextRevision(record: { revision: number }): number {
  return record.revision + 1;
}

async function recordChange(change: Omit<ChangeRecord, "sequence">): Promise<void> {
  await db.changeLog.add(change);
}

export class LocalRepository {
  async initialize(): Promise<void> {
    const settings = await db.settings.get("app");
    if (settings?.legacyMigrationComplete) return;

    const legacy = await readLegacyState();
    const normalized = legacy ? await normalizeLegacyState(legacy) : {
      assets: defaultAssets,
      stickers: defaultStickers,
      journals: defaultJournals,
      journalPages: defaultJournalPages,
      settings: currentSettings()
    };

    await db.transaction("rw", [db.assets, db.stickers, db.journals, db.journalPages, db.settings], async () => {
      await db.assets.bulkPut(normalized.assets);
      await db.stickers.bulkPut(normalized.stickers);
      await db.journals.bulkPut(normalized.journals);
      await db.journalPages.bulkPut(normalized.journalPages);
      await db.settings.put(normalized.settings);
    });
  }

  async snapshot(): Promise<AppSnapshot> {
    const [assets, stickers, journals, journalPages, settings] = await Promise.all([
      db.assets.filter((item) => item.deletedAt === undefined).toArray(),
      db.stickers.filter((item) => item.deletedAt === undefined).toArray(),
      db.journals.filter((item) => item.deletedAt === undefined).toArray(),
      db.journalPages.filter((item) => item.deletedAt === undefined).toArray(),
      db.settings.get("app")
    ]);
    return { assets, stickers, journals, journalPages, settings: settingsRecordSchema.parse(settings ?? currentSettings()) };
  }

  async putAsset(input: AssetRecord): Promise<AssetRecord> {
    const record = assetRecordSchema.parse(input);
    await db.transaction("rw", [db.assets, db.changeLog], async () => {
      await db.assets.put(record);
      await recordChange({ entityType: "asset", entityId: record.id, operation: "put", revision: record.revision, changedAt: record.updatedAt });
    });
    return record;
  }

  async putSticker(input: StickerRecord): Promise<StickerRecord> {
    const record = stickerRecordSchema.parse(input);
    await db.transaction("rw", [db.stickers, db.changeLog], async () => {
      await db.stickers.put(record);
      await recordChange({ entityType: "sticker", entityId: record.id, operation: "put", revision: record.revision, changedAt: record.updatedAt });
    });
    return record;
  }

  async updateSticker(id: string, update: Partial<Pick<StickerRecord, "name" | "group" | "finish" | "edgeThickness" | "border" | "tilt">>): Promise<StickerRecord> {
    const existing = await db.stickers.get(id);
    if (!existing) throw new Error("Sticker not found.");
    return await this.putSticker({ ...existing, ...update, revision: nextRevision(existing), updatedAt: Date.now() });
  }

  async deleteSticker(id: string): Promise<void> {
    const existing = await db.stickers.get(id);
    if (!existing) return;
    const updatedAt = Date.now();
    const deleted = stickerRecordSchema.parse({ ...existing, revision: nextRevision(existing), updatedAt, deletedAt: updatedAt });
    await db.transaction("rw", [db.stickers, db.changeLog], async () => {
      await db.stickers.put(deleted);
      await recordChange({ entityType: "sticker", entityId: id, operation: "delete", revision: deleted.revision, changedAt: updatedAt });
    });
  }

  async putJournal(input: JournalRecord): Promise<JournalRecord> {
    const record = journalRecordSchema.parse(input);
    await db.transaction("rw", [db.journals, db.changeLog], async () => {
      await db.journals.put(record);
      await recordChange({ entityType: "journal", entityId: record.id, operation: "put", revision: record.revision, changedAt: record.updatedAt });
    });
    return record;
  }

  async putJournalPage(input: JournalPageRecord): Promise<JournalPageRecord> {
    const record = journalPageRecordSchema.parse(input);
    await db.transaction("rw", [db.journalPages, db.changeLog], async () => {
      await db.journalPages.put(record);
      await recordChange({ entityType: "journalPage", entityId: record.id, operation: "put", revision: record.revision, changedAt: record.updatedAt });
    });
    return record;
  }

  async dismissCrossOriginMigration(): Promise<void> {
    const settings = await db.settings.get("app") ?? currentSettings();
    await db.settings.put({ ...settings, crossOriginMigrationDismissed: true, updatedAt: Date.now() });
  }

  async restoreLegacy(state: LegacyState): Promise<void> {
    const normalized = await normalizeLegacyState(state);
    await db.transaction("rw", [db.assets, db.stickers, db.journals, db.journalPages, db.settings, db.changeLog], async () => {
      await Promise.all([db.assets.clear(), db.stickers.clear(), db.journals.clear(), db.journalPages.clear(), db.changeLog.clear()]);
      await db.assets.bulkPut(normalized.assets);
      await db.stickers.bulkPut(normalized.stickers);
      await db.journals.bulkPut(normalized.journals);
      await db.journalPages.bulkPut(normalized.journalPages);
      await db.settings.put({ ...normalized.settings, crossOriginMigrationDismissed: true });
    });
  }

  async replaceSnapshot(snapshot: AppSnapshot): Promise<void> {
    const parsed = {
      assets: snapshot.assets.map((item) => assetRecordSchema.parse(item)),
      stickers: snapshot.stickers.map((item) => stickerRecordSchema.parse(item)),
      journals: snapshot.journals.map((item) => journalRecordSchema.parse(item)),
      journalPages: snapshot.journalPages.map((item) => journalPageRecordSchema.parse(item)),
      settings: settingsRecordSchema.parse(snapshot.settings)
    };
    await db.transaction("rw", [db.assets, db.stickers, db.journals, db.journalPages, db.settings, db.changeLog], async () => {
      await Promise.all([db.assets.clear(), db.stickers.clear(), db.journals.clear(), db.journalPages.clear(), db.changeLog.clear()]);
      await db.assets.bulkPut(parsed.assets);
      await db.stickers.bulkPut(parsed.stickers);
      await db.journals.bulkPut(parsed.journals);
      await db.journalPages.bulkPut(parsed.journalPages);
      await db.settings.put(parsed.settings);
    });
  }

  async clearForTests(): Promise<void> {
    await Dexie.delete(db.name);
    await db.open();
  }
}

export const localRepository = new LocalRepository();
