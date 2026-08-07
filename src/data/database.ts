import Dexie, { type EntityTable } from "dexie";

import type {
  AssetRecord,
  ChangeRecord,
  JournalPageRecord,
  JournalRecord,
  SettingsRecord,
  StickerRecord
} from "@/domain/model";

class MementoDatabase extends Dexie {
  assets!: EntityTable<AssetRecord, "id">;
  stickers!: EntityTable<StickerRecord, "id">;
  journals!: EntityTable<JournalRecord, "id">;
  journalPages!: EntityTable<JournalPageRecord, "id">;
  settings!: EntityTable<SettingsRecord, "id">;
  changeLog!: EntityTable<ChangeRecord, "sequence">;

  constructor() {
    super("memento-journal-react");
    this.version(1).stores({
      assets: "id, updatedAt, deletedAt, remoteKey",
      stickers: "id, group, createdAt, updatedAt, deletedAt, assetId",
      journals: "id, updatedAt, deletedAt",
      journalPages: "id, [journalId+pageNumber], journalId, updatedAt, deletedAt",
      settings: "id, updatedAt",
      changeLog: "++sequence, [entityType+entityId], changedAt"
    });
  }
}

export const db = new MementoDatabase();
