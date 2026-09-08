import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("fabric", () => ({
  FabricImage: {
    fromURL: vi.fn(async () => { throw new Error("decode failure") }),
  },
}))

import { appendCanvasHistory, emptyCanvasDocument, moveCanvasHistory } from "@/domain/editor"
import { createCanvasWriteQueue } from "@/hooks/useCanvasHistory"

describe("canvas page write queue", () => {
  it("serializes rapid drag commits and lets undo build from the newest state", async () => {
    const queue = createCanvasWriteQueue()
    const writes: string[] = []
    let resolveFirst: (() => void) | undefined
    const firstDone = new Promise<void>((resolve) => { resolveFirst = resolve })
    const dragOne = queue.next("page-1", "edit")
    const dragTwo = queue.next("page-1", "edit")
    const undo = queue.next("page-1", "undo")

    const first = queue.enqueue(dragOne, async () => {
      writes.push("drag-1")
      await firstDone
      return "first"
    })
    const second = queue.enqueue(dragTwo, async () => {
      writes.push("drag-2")
      return "second"
    })
    const third = queue.enqueue(undo, async () => {
      writes.push("undo")
      return "third"
    })

    await Promise.resolve()
    expect(writes).toEqual(["drag-1"])
    resolveFirst?.()
    await expect(Promise.all([first, second, third])).resolves.toEqual(["first", "second", "third"])
    expect(writes).toEqual(["drag-1", "drag-2", "undo"])
  })

  it("keeps page queues independent during a quick page switch", async () => {
    const queue = createCanvasWriteQueue()
    const writes: string[] = []
    let resolvePageOne: (() => void) | undefined
    const pageOneDone = new Promise<void>((resolve) => { resolvePageOne = resolve })
    const pageOne = queue.enqueue(queue.next("page-1", "edit"), async () => {
      await pageOneDone
      writes.push("page-1")
    })
    const pageTwo = queue.enqueue(queue.next("page-2", "edit"), async () => {
      writes.push("page-2")
    })

    await pageTwo
    expect(writes).toEqual(["page-2"])
    resolvePageOne?.()
    await pageOne
    expect(writes).toEqual(["page-2", "page-1"])
  })

  it("keeps a failed image object in the document while history moves back", () => {
    const initial = emptyCanvasDocument()
    const withSticker = { version: 1 as const, objects: [{ id: "missing", kind: "sticker" as const, stickerId: "sticker-1", x: .5, y: .5, size: .2, angle: 0, zIndex: 0 }] }
    const history = appendCanvasHistory({ entries: [initial], index: 0 }, withSticker)
    expect(history.entries[1]?.objects[0]?.id).toBe("missing")
    expect(moveCanvasHistory(history, -1)?.document).toEqual(initial)
    expect(history.entries[history.index]?.objects[0]?.stickerId).toBe("sticker-1")
  })
})

describe("sticker image decode failures", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("rejects when both the outlined and direct image decode fail", async () => {
    const { fabricImageFromSource } = await import("@/lib/canvasImages")
    const error = await fabricImageFromSource("data:image/png;base64,invalid", 3, 116).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/decode|image|Unable/i)
  })
})
