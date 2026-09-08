import Dexie, { type EntityTable } from "dexie";

import type {
  AssetRecord,
  ChangeRecord,
  JournalPageRecord,
  JournalRecord,
  SettingsRecord,
  StickerRecord
} from "@/domain/model";
import type { BatchUploadItemRecord, BatchUploadJobRecord } from "@/data/batchUploads";

export interface SyncProgress {
  id: "cloud";
  cursor: number;
  confirmedSequence: number;
  recoveryQueued: boolean;
  legacySequence: number;
}

export class MementoDatabase extends Dexie {
  assets!: EntityTable<AssetRecord, "id">;
  stickers!: EntityTable<StickerRecord, "id">;
  journals!: EntityTable<JournalRecord, "id">;
  journalPages!: EntityTable<JournalPageRecord, "id">;
  settings!: EntityTable<SettingsRecord, "id">;
  changeLog!: EntityTable<ChangeRecord, "sequence">;
  batchUploadJobs!: EntityTable<BatchUploadJobRecord, "id">;
  batchUploadItems!: EntityTable<BatchUploadItemRecord, "id">;
  syncProgress!: EntityTable<SyncProgress, "id">;

  constructor(name = "memento-journal-react") {
    super(name);
    this.version(1).stores({
      assets: "id, updatedAt, deletedAt, remoteKey",
      stickers: "id, group, createdAt, updatedAt, deletedAt, assetId",
      journals: "id, updatedAt, deletedAt",
      journalPages: "id, [journalId+pageNumber], journalId, updatedAt, deletedAt",
      settings: "id, updatedAt",
      changeLog: "++sequence, [entityType+entityId], changedAt"
    });
    this.version(2).stores({
      assets: "id, updatedAt, deletedAt, remoteKey",
      stickers: "id, group, createdAt, updatedAt, deletedAt, assetId",
      journals: "id, updatedAt, deletedAt",
      journalPages: "id, [journalId+pageNumber], journalId, updatedAt, deletedAt",
      settings: "id, updatedAt",
      changeLog: "++sequence, [entityType+entityId], changedAt",
      batchUploadJobs: "id, status, updatedAt",
      batchUploadItems: "id, jobId, [jobId+status], status, updatedAt"
    });
    this.version(3).stores({ syncProgress: "id" });
  }
}

export const db = new MementoDatabase();

export function createUserDatabase(userId: string): MementoDatabase {
  return new MementoDatabase(`memento-journal-react-user-${userId}`);
}
