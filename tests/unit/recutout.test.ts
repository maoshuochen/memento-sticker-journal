import { describe, expect, it } from "vitest"

import { clampCropSelection } from "@/lib/recutout"

describe("re-cutout selection", () => {
  it("keeps a rotated selection wholly inside the editable source", () => {
    const selection = clampCropSelection({ x: .98, y: .02, width: 1, height: .8, angle: 45 })
    const radians = selection.angle * Math.PI / 180
    const horizontalExtent = (Math.abs(Math.cos(radians)) * selection.width + Math.abs(Math.sin(radians)) * selection.height) / 2
    const verticalExtent = (Math.abs(Math.sin(radians)) * selection.width + Math.abs(Math.cos(radians)) * selection.height) / 2

    expect(selection.x - horizontalExtent).toBeGreaterThanOrEqual(-0.000_001)
    expect(selection.x + horizontalExtent).toBeLessThanOrEqual(1.000_001)
    expect(selection.y - verticalExtent).toBeGreaterThanOrEqual(-0.000_001)
    expect(selection.y + verticalExtent).toBeLessThanOrEqual(1.000_001)
  })

  it("does not change a normal unrotated selection", () => {
    expect(clampCropSelection({ x: .5, y: .5, width: .6, height: .4, angle: 0 })).toEqual({
      x: .5,
      y: .5,
      width: .6,
      height: .4,
      angle: 0,
    })
  })
})
