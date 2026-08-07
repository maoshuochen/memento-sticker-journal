import { describe, expect, it } from "vitest"

import { appendHistory, moveHistory } from "@/domain/editor"
import type { Placement } from "@/domain/model"

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
