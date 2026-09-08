import { describe, expect, it } from "vitest"
import Matter from "matter-js"

import { gravityFromOrientation, isGravityBodySupported, isSignificantMotion, motionAccelerationMagnitude, shelfGravityFromOrientation } from "@/hooks/useGravityDrop"
import { gravityColumnCount, gravityDimensions, gravityInitialState, gravityShelfHeight, stickerSeed } from "@/lib/gravity"

describe("sticker shelf gravity", () => {
  it("derives deterministic bodies from each sticker id", () => {
    expect(stickerSeed("sample-1")).toBe(stickerSeed("sample-1"))
    expect(gravityDimensions("sample-1")).toEqual(gravityDimensions("sample-1"))
    expect(gravityDimensions("sample-1")).toEqual(gravityDimensions("sample-9"))
    expect(gravityInitialState("sample-1", 0, 360, 480, false).y).toBeLessThan(0)
  })

  it("uses the migration-era two or three column shelf sizing", () => {
    expect(gravityColumnCount(309)).toBe(2)
    expect(gravityColumnCount(310)).toBe(3)
    expect(gravityShelfHeight(9, 360, 400)).toBe(400)
    expect(gravityShelfHeight(16, 360, 400)).toBe(618)
  })

  it("keeps a deterministic spawn sequence for the Matter.js world", () => {
    const first = gravityInitialState("sample-1", 0, 360, 480, false)
    const next = gravityInitialState("sample-2", 1, 360, 480, false)

    expect(first).toEqual(gravityInitialState("sample-1", 0, 360, 480, false))
    expect(next.y).toBeLessThan(first.y)
    expect(first.x).toBeGreaterThanOrEqual(5)
    expect(first.x).toBeLessThan(360)
  })

  it("projects device tilt onto the shelf and respects screen rotation", () => {
    expect(gravityFromOrientation(90, 0)).toEqual({ x: 0, y: 1 })
    expect(gravityFromOrientation(0, 90)).toEqual({ x: 1, y: 0 })
    expect(gravityFromOrientation(0, 90, 90)).toEqual({ x: 0, y: -1 })
    expect(Math.hypot(gravityFromOrientation(45, 45).x, gravityFromOrientation(45, 45).y)).toBeLessThanOrEqual(1)
  })

  it("keeps a downward pull while using orientation only to tilt the pile", () => {
    expect(shelfGravityFromOrientation(0, 0)).toEqual({ x: 0, y: 1 })
    expect(shelfGravityFromOrientation(0, 90)).toEqual({ x: .7, y: 1 })
    expect(shelfGravityFromOrientation(-90, 0).y).toBeGreaterThanOrEqual(.72)
  })

  it("detects shake acceleration without treating static gravity as motion", () => {
    expect(motionAccelerationMagnitude({ acceleration: { x: 3, y: 0, z: 0 } })).toBe(3)
    expect(motionAccelerationMagnitude({ accelerationIncludingGravity: { x: 0, y: 9.81, z: 0 } })).toBeCloseTo(0)
    expect(isSignificantMotion({ acceleration: { x: 2.5, y: 0, z: 0 } })).toBe(true)
    expect(isSignificantMotion({ acceleration: { x: .8, y: .4, z: 0 } })).toBe(false)
  })

  it("never treats an airborne or wall-adjacent sticker as settled", () => {
    const floor = Matter.Bodies.rectangle(160, 220, 320, 32, { isStatic: true })
    const supported = Matter.Bodies.circle(120, 182, 24)
    const stacked = Matter.Bodies.circle(120, 136, 24)
    const suspended = Matter.Bodies.circle(24, 80, 24)
    const wall = Matter.Bodies.rectangle(0, 120, 20, 240, { isStatic: true })

    expect(isGravityBodySupported(suspended, floor, [suspended, supported, stacked, wall])).toBe(false)
    expect(isGravityBodySupported(supported, floor, [supported, stacked])).toBe(true)
    expect(isGravityBodySupported(stacked, floor, [supported, stacked])).toBe(true)
  })
})
