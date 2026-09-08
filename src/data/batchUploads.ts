export const MAX_BATCH_UPLOAD_FILES = 50

/**
 * Alibaba's default paid API allowance is 2 QPS. Keep the client below that
 * ceiling with a little headroom instead of relying on a bursty server-side
 * window limiter. Two requests may be in flight so slow cutouts do not turn
 * into an unnecessarily long, strictly serial batch.
 */
export const BATCH_MAX_IN_FLIGHT_REQUESTS = 2
export const BATCH_REQUEST_START_INTERVAL_MS = 550

/** A tiny deterministic gate shared by the workers processing one batch. */
export class BatchRequestStartGate {
  private nextStartAt = 0

  reserve(now = Date.now()): number {
    const startAt = Math.max(now, this.nextStartAt)
    this.nextStartAt = startAt + BATCH_REQUEST_START_INTERVAL_MS
    return startAt
  }
}

export type BatchUploadJobStatus = "queued" | "processing" | "paused" | "review"
export type BatchUploadItemStatus = "queued" | "processing" | "ready" | "failed"

export interface BatchUploadJobRecord {
  id: string
  createdAt: number
  updatedAt: number
  status: BatchUploadJobStatus
  groupHints: string[]
}

/**
 * Staging records are deliberately local-only. Their source and cutout blobs
 * must never be added to changeLog until the user explicitly saves them.
 */
export interface BatchUploadItemRecord {
  id: string
  jobId: string
  createdAt: number
  updatedAt: number
  sourceBlob: Blob
  sourceName: string
  status: BatchUploadItemStatus
  attempts: number
  retryAt?: number | undefined
  error?: string | undefined
  cutoutBlob?: Blob | undefined
  /** A compressed private original, retained only until the user saves. */
  editableSourceBlob?: Blob | undefined
  recognizedName?: string | undefined
  suggestedGroup?: string | undefined
  selected: boolean
}

export interface BatchUploadSnapshot {
  job: BatchUploadJobRecord
  items: BatchUploadItemRecord[]
}

export interface BatchStickerSaveInput {
  batchItemId: string
  blob: Blob
  sourceBlob?: Blob
  name: string
  group: string
  finish: "edge-soft" | "edge-bold" | "edge-lift"
  edgeThickness: number
  border: "sticker-clean" | "sticker-torn" | "sticker-polaroid"
}
