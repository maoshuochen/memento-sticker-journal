import { describe, expect, it } from "vitest"

import { appendCanvasHistory, appendHistory, canvasDocumentFromPlacements, canvasTextFontFamily, canvasTextFontLoadDescriptor, moveCanvasHistory, moveHistory, normalizeAngle, pointerAngle, shortestAngleDelta } from "@/domain/editor"
import { canvasDocumentSchema, type CanvasDocument, type Placement } from "@/domain/model"
import { shouldApplyRemoteRecord } from "@/data/repository"

const placement = (id: string): Placement => ({ id, left: 10, top: 20, angle: 0, scale: 1, zIndex: 1 })

describe("journal edit history", () => {
  it("drops redo entries when a new edit is committed", () => {
    const history = { entries: [[placement("one")], [placement("two")], [placement("three")]], index: 1 }
    const result = appendHistory(history, [placement("fresh")])
    expect(result.entries.map((entry) => entry[0]?.id)).toEqual(["one", "two", "fresh"])
    expect(result.index).toBe(2)
  })

  it("moves backward and forward without mutating the entries", () => {
    const history = { entries: [[], [placement("one")]], index: 1 }
    expect(moveHistory(history, -1)?.placements).toEqual([])
    expect(moveHistory({ ...history, index: 0 }, -1)).toBeNull()
  })
})

describe("canvas document migration", () => {
  it("keeps old sticker identity, transform, and layer while normalizing its geometry", () => {
    const document = canvasDocumentFromPlacements([{
      id: "sticker-1::instance-a",
      left: 204,
      top: 125,
      angle: 8,
      scale: 1,
      zIndex: 4,
    }])
    expect(document).toEqual({
      version: 1,
      objects: [expect.objectContaining({
        id: "sticker-1::instance-a",
        kind: "sticker",
        stickerId: "sticker-1",
        angle: 8,
        zIndex: 4,
      })],
    })
    expect(document.objects[0]).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), size: expect.any(Number) }))
  })

  it("records canvas snapshots without retaining references to mutable objects", () => {
    const initial: CanvasDocument = { version: 1, objects: [] }
    const changed: CanvasDocument = { version: 1, objects: [{ id: "text-1", kind: "text", text: "hello", color: "#9a6547", x: .5, y: .5, width: .4, fontSize: .05, angle: 0, zIndex: 1 }] }
    const history = appendCanvasHistory({ entries: [initial], index: 0 }, changed)
    changed.objects[0]!.text = "changed after save"
    expect(history.entries[1]?.objects[0]).toEqual(expect.objectContaining({ text: "hello" }))
    expect(moveCanvasHistory(history, -1)?.document).toEqual(initial)
  })

  it("keeps a text color in canvas snapshots", () => {
    const document: CanvasDocument = {
      version: 1,
      objects: [{ id: "text-1", kind: "text", text: "hello", color: "#66768a", x: .5, y: .5, width: .4, fontSize: .05, angle: 0, zIndex: 1 }],
    }
    const history = appendCanvasHistory({ entries: [{ version: 1, objects: [] }], index: 0 }, document)
    expect(history.entries[1]?.objects[0]).toEqual(expect.objectContaining({ kind: "text", color: "#66768a" }))
  })

  it("accepts a normalized tape strip with independently persisted length", () => {
    const document = canvasDocumentSchema.parse({
      version: 1,
      objects: [{ id: "tape-1", kind: "tape", color: "#e9b982", x: .5, y: .45, width: .72, height: .055, angle: -6, zIndex: 2 }],
    })
    expect(document.objects[0]).toEqual(expect.objectContaining({ kind: "tape", width: .72, height: .055, angle: -6 }))
  })

  it("persists text styles while accepting older text records", () => {
    const legacy = { version: 1, objects: [{ id: "text-1", kind: "text", text: "hello", x: .5, y: .5, width: .4, fontSize: .05, angle: 0, zIndex: 1 }] }
    const styled = { ...legacy, objects: [{ ...legacy.objects[0], font: "handwritten" }] }
    expect(canvasDocumentSchema.parse(legacy).objects[0]).not.toHaveProperty("font")
    expect(canvasDocumentSchema.parse(styled).objects[0]).toEqual(expect.objectContaining({ font: "handwritten" }))
    expect(canvasTextFontFamily("handwritten")).toContain("ZCOOL KuaiLe")
    expect(canvasTextFontFamily("yozai")).toContain("Yozai")
    expect(canvasTextFontLoadDescriptor("yozai")).toBe('400 32px "Yozai"')
    expect(canvasTextFontFamily("serif")).toContain("Georgia")
    expect(canvasTextFontFamily("sans")).toContain("Geist Variable")
  })
})

describe("free rotation geometry", () => {
  it("calculates pointer angles around the sticker center", () => {
    expect(pointerAngle(10, 10, 20, 10)).toBe(0)
    expect(pointerAngle(10, 10, 10, 20)).toBe(90)
    expect(pointerAngle(10, 10, 10, 0)).toBe(-90)
  })

  it("continues smoothly across the 180 degree boundary", () => {
    expect(shortestAngleDelta(179, -179)).toBe(2)
    expect(shortestAngleDelta(-179, 179)).toBe(-2)
  })

  it("stores equivalent rotations in a stable range", () => {
    expect(normalizeAngle(541)).toBe(-179)
    expect(normalizeAngle(-540)).toBe(-180)
  })
})

describe("canvas sync ordering", () => {
  it("does not allow a delayed remote document to reset a newer local style", () => {
    expect(shouldApplyRemoteRecord({ revision: 9, updatedAt: 20_000 }, { revision: 8, updatedAt: 19_000 })).toBe(false)
    expect(shouldApplyRemoteRecord({ revision: 9, updatedAt: 20_000 }, { revision: 10, updatedAt: 20_000 })).toBe(true)
  })
})
