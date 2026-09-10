import { describe, expect, it } from "vitest"

import { TAPE_PATTERN_CELL_RATIO, tapePatternOffset, tapePatternPixelRatio, tapePatternRepeatCount } from "@/lib/tapePattern"

describe("tape pattern layout", () => {
  it("adds whole repeated cells as the tape gets longer", () => {
    const height = 40
    const cellWidth = height * TAPE_PATTERN_CELL_RATIO
    expect(tapePatternRepeatCount(cellWidth, height)).toBe(1)
    expect(tapePatternRepeatCount(cellWidth + 1, height)).toBe(2)
    expect(tapePatternRepeatCount(cellWidth * 4, height)).toBe(4)
  })

  it("centers the clipped cells along the tape", () => {
    expect(tapePatternOffset(108, 54)).toBe(0)
    expect(tapePatternOffset(81, 54)).toBe(-13.5)
    expect(tapePatternOffset(0, 54)).toBe(0)
  })

  it("returns no cells for invalid geometry", () => {
    expect(tapePatternRepeatCount(100, 0)).toBe(0)
    expect(tapePatternRepeatCount(-1, 40)).toBe(0)
  })

  it("renders pattern tiles at retina density without unbounded allocation", () => {
    expect(tapePatternPixelRatio(1)).toBe(2)
    expect(tapePatternPixelRatio(2.5)).toBe(2.5)
    expect(tapePatternPixelRatio(4)).toBe(3)
    expect(tapePatternPixelRatio(Number.NaN)).toBe(2)
  })
})
