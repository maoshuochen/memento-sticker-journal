import type { ChangeRecord } from "@/domain/model";

export interface SyncPushResult {
  acceptedThrough: number;
  conflicts: string[];
}

export interface SyncPullResult {
  cursor: string | null;
  changes: ChangeRecord[];
}

export interface SyncAdapter {
  push(changes: ChangeRecord[]): Promise<SyncPushResult>;
  pull(cursor: string | null): Promise<SyncPullResult>;
}

export class NoopSyncAdapter implements SyncAdapter {
  async push(changes: ChangeRecord[]): Promise<SyncPushResult> {
    await Promise.resolve();
    return { acceptedThrough: changes.at(-1)?.sequence ?? 0, conflicts: [] };
  }

  async pull(cursor: string | null): Promise<SyncPullResult> {
    await Promise.resolve();
    return { cursor, changes: [] };
  }
}
