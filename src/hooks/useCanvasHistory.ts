export type CanvasOperationKind = "edit" | "undo" | "redo"

/** A monotonic token is scoped to one persisted page. */
export interface CanvasOperationToken {
  pageId: string
  sequence: number
  kind: CanvasOperationKind
  documentKey?: string | undefined
}

export interface CanvasWriteQueue {
  next(pageId: string, kind?: CanvasOperationKind, documentKey?: string): CanvasOperationToken
  enqueue<T>(token: CanvasOperationToken, task: () => Promise<T>): Promise<T>
}

/**
 * Serialize writes independently per page.  An edit on page 1 must not block
 * page 2 forever, while two edits on the same page must always build from the
 * latest persisted page record.  Failed writes release the queue so a later
 * retry can proceed without losing sequence ordering.
 */
export function createCanvasWriteQueue(): CanvasWriteQueue {
  const tails = new Map<string, Promise<void>>()
  const sequences = new Map<string, number>()

  return {
    next(pageId, kind = "edit", documentKey) {
      const sequence = (sequences.get(pageId) ?? 0) + 1
      sequences.set(pageId, sequence)
      return { pageId, sequence, kind, documentKey }
    },
    enqueue<T>(token: CanvasOperationToken, task: () => Promise<T>): Promise<T> {
      const knownSequence = sequences.get(token.pageId) ?? 0
      if (token.sequence > knownSequence) sequences.set(token.pageId, token.sequence)
      const previous = tails.get(token.pageId) ?? Promise.resolve()
      const run: Promise<T> = previous.then(() => task(), () => task())
      tails.set(token.pageId, run.then(() => undefined, () => undefined))
      return run
    },
  }
}
