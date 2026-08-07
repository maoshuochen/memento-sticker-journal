import { z } from "zod";

import { legacyStateSchema, normalizeLegacyState, type LegacyState } from "@/data/legacy";
import {
  journalPageRecordSchema,
  journalRecordSchema,
  settingsRecordSchema,
  stickerRecordSchema,
  type AppSnapshot,
  type AssetRecord
} from "@/domain/model";

const legacyBackupSchema = z.object({
  format: z.literal("memento-backup"),
  version: z.literal(1),
  exportedAt: z.string(),
  state: legacyStateSchema
});

const serializedAssetSchema = z.object({
  id: z.string(),
  revision: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().optional(),
  mimeType: z.string(),
  dataUrl: z.string().optional(),
  url: z.string().optional(),
  remoteKey: z.string().optional()
}).refine((asset) => Boolean(asset.dataUrl ?? asset.url), "Backup asset has no source.");

const backupV2Schema = z.object({
  format: z.literal("memento-backup"),
  version: z.literal(2),
  exportedAt: z.string(),
  state: z.object({
    assets: z.array(serializedAssetSchema),
    stickers: z.array(stickerRecordSchema),
    journals: z.array(journalRecordSchema),
    journalPages: z.array(journalPageRecordSchema),
    settings: settingsRecordSchema
  })
});

export type ParsedBackup =
  | { version: 1; legacy: LegacyState }
  | { version: 2; snapshot: AppSnapshot };

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read sticker image."));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read sticker image."));
    reader.readAsDataURL(blob);
  });
}

async function serializeAsset(asset: AssetRecord) {
  return {
    id: asset.id,
    revision: asset.revision,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    ...(asset.deletedAt === undefined ? {} : { deletedAt: asset.deletedAt }),
    mimeType: asset.mimeType,
    ...(asset.blob ? { dataUrl: await blobToDataUrl(asset.blob) } : {}),
    ...(asset.url ? { url: asset.url } : {}),
    ...(asset.remoteKey ? { remoteKey: asset.remoteKey } : {})
  };
}

export async function createBackupBlob(snapshot: AppSnapshot): Promise<Blob> {
  const assets = await Promise.all(snapshot.assets.map(serializeAsset));
  const backup = {
    format: "memento-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    state: { ...snapshot, assets }
  };
  return new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return await response.blob();
}

export async function parseBackupFile(file: File): Promise<ParsedBackup> {
  if (file.size > 25 * 1024 * 1024) throw new Error("That backup is too large to restore here.");
  let source: unknown;
  try {
    source = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  const legacy = legacyBackupSchema.safeParse(source);
  if (legacy.success) return { version: 1, legacy: legacy.data.state };

  const current = backupV2Schema.safeParse(source);
  if (!current.success) throw new Error("That file is not a valid Memento backup.");

  const assets = await Promise.all(current.data.state.assets.map(async (asset): Promise<AssetRecord> => ({
    id: asset.id,
    revision: asset.revision,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    ...(asset.deletedAt === undefined ? {} : { deletedAt: asset.deletedAt }),
    mimeType: asset.mimeType,
    ...(asset.dataUrl ? { blob: await dataUrlToBlob(asset.dataUrl) } : {}),
    ...(asset.url ? { url: asset.url } : {}),
    ...(asset.remoteKey ? { remoteKey: asset.remoteKey } : {})
  })));

  return { version: 2, snapshot: { ...current.data.state, assets } };
}

export async function backupToSnapshot(parsed: ParsedBackup): Promise<AppSnapshot> {
  if (parsed.version === 2) return parsed.snapshot;
  return await normalizeLegacyState(parsed.legacy);
}
