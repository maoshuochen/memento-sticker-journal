import Matter from "matter-js"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { gravityDimensions, gravityInitialState, stickerSeed } from "@/lib/gravity"

const { Bodies, Body, Collision, Composite, Engine, Sleeping } = Matter
const maxStickerTilt = .22
const shakeThreshold = 2.4
const shakeThrottleMs = 160
// At 120 Hz this reaches a new tilt quickly while still easing the direction
// over a few frames instead of snapping the pile sideways.
const gravitySmoothing = .16
const initialDropVelocityScale = 1.12
const shelfTiltStrength = .7
const shelfMinimumDownwardGravity = .72

export interface GravityVector {
  x: number
  y: number
}

export interface MotionAccelerationSample {
  acceleration?: { x: number | null; y: number | null; z: number | null } | null
  accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null } | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Project the device gravity vector onto the phone's visible surface. */
export function gravityFromOrientation(beta: number, gamma: number, screenAngle = 0): GravityVector {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return { x: 0, y: 1 }

  const betaRadians = clamp(beta, -90, 90) * Math.PI / 180
  const gammaRadians = clamp(gamma, -90, 90) * Math.PI / 180
  let x = Math.sin(gammaRadians)
  let y = Math.sin(betaRadians) * Math.cos(gammaRadians)
  const magnitude = Math.hypot(x, y)
  if (magnitude > 1) {
    x /= magnitude
    y /= magnitude
  }

  const normalizedAngle = ((Math.round(screenAngle / 90) * 90) % 360 + 360) % 360
  if (normalizedAngle === 90) return { x: y, y: -x }
  if (normalizedAngle === 180) return { x: -x, y: -y }
  if (normalizedAngle === 270) return { x: -y, y: x }
  return { x, y }
}

/**
 * The shelf always has a floor: device orientation only tilts the pile, it
 * never removes its downward pull. A raw orientation vector is zero while a
 * phone is held upright, which previously left late-arriving bodies drifting
 * in mid-air after the rest of the pile had landed.
 */
export function shelfGravityFromOrientation(beta: number, gamma: number, screenAngle = 0): GravityVector {
  const orientation = gravityFromOrientation(beta, gamma, screenAngle)
  return {
    x: clamp(orientation.x * shelfTiltStrength, -shelfTiltStrength, shelfTiltStrength),
    y: clamp(1 + orientation.y * .28, shelfMinimumDownwardGravity, 1.28),
  }
}

function vectorMagnitude(value: { x: number | null; y: number | null; z: number | null } | null | undefined): number | null {
  if (!value || ![value.x, value.y, value.z].every((component) => typeof component === "number" && Number.isFinite(component))) return null
  return Math.hypot(value.x!, value.y!, value.z!)
}

/** Returns motion excluding the device's approximately 1g static acceleration. */
export function motionAccelerationMagnitude(sample: MotionAccelerationSample): number {
  const acceleration = vectorMagnitude(sample.acceleration)
  if (acceleration !== null) return acceleration
  const includingGravity = vectorMagnitude(sample.accelerationIncludingGravity)
  return includingGravity === null ? 0 : Math.max(0, includingGravity - 9.81)
}

export function isSignificantMotion(sample: MotionAccelerationSample, threshold = shakeThreshold): boolean {
  return motionAccelerationMagnitude(sample) >= threshold
}

interface GravityBody {
  body: Matter.Body
  element: HTMLButtonElement
  height: number
  index: number
  width: number
}

type SensorPermission = "unknown" | "granted" | "denied" | "unsupported"

interface GravityRuntime {
  engine: Matter.Engine
  bodies: GravityBody[]
  floor: Matter.Body | null
  gravityCurrent: GravityVector
  gravityTarget: GravityVector
  reducedMotion: boolean
  sensorActive: boolean
  settled: boolean
  lastShakeAt: number
  restart?: () => void
  orientationListener: ((event: DeviceOrientationEvent) => void) | undefined
  motionListener: ((event: DeviceMotionEvent) => void) | undefined
}

interface PermissionedSensorConstructor {
  requestPermission?: () => Promise<"granted" | "denied">
}

function placeGravityBody({ body, element, height, index, width }: GravityBody): void {
  const x = body.position.x - width / 2
  const y = body.position.y - height / 2
  const angle = Math.max(-maxStickerTilt, Math.min(maxStickerTilt, body.angle))
  element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${angle.toFixed(3)}rad)`
  element.style.zIndex = String(10 + index)
}

function stopBodies(bodies: GravityBody[]): void {
  for (const { body } of bodies) {
    Body.setVelocity(body, { x: 0, y: 0 })
    Body.setAngularVelocity(body, 0)
    Sleeping.set(body, true)
  }
}

function wakeBodies(bodies: GravityBody[]): void {
  for (const { body } of bodies) Sleeping.set(body, false)
}

/**
 * Sleeping only measures velocity. A body can be nearly still while floating
 * or pressed into a side wall, so it is eligible to sleep only with contact
 * support underneath it.
 */
export function isGravityBodySupported(body: Matter.Body, floor: Matter.Body | null, bodies: Matter.Body[]): boolean {
  if (floor && Collision.collides(body, floor)) return true

  return bodies.some((candidate) => {
    if (candidate === body || candidate.isStatic) return false
    // A side collision is not support: the other object must be lower.
    return candidate.position.y > body.position.y + 1 && Collision.collides(body, candidate) !== null
  })
}

function keepUnsupportedBodiesAwake(runtime: GravityRuntime): boolean {
  const bodies = runtime.bodies.map(({ body }) => body)
  let allSupported = true
  for (const { body } of runtime.bodies) {
    if (!isGravityBodySupported(body, runtime.floor, bodies)) {
      Sleeping.set(body, false)
      allSupported = false
    }
  }
  return allSupported
}

function sensorConstructor(name: "orientation" | "motion"): PermissionedSensorConstructor | undefined {
  if (typeof window === "undefined") return undefined
  const constructor = name === "orientation" ? window.DeviceOrientationEvent : window.DeviceMotionEvent
  return constructor as unknown as PermissionedSensorConstructor | undefined
}

function screenOrientationAngle(): number {
  if (typeof window === "undefined") return 0
  const orientationAngle = window.screen.orientation?.angle
  if (typeof orientationAngle === "number") return orientationAngle
  const legacyAngle = window.orientation
  return typeof legacyAngle === "number" ? legacyAngle : 0
}

export function useGravityDrop(stickerKey: string) {
  const shelfRef = useRef<HTMLDivElement>(null)
  const animationFrame = useRef<number | null>(null)
  const runtimeRef = useRef<GravityRuntime | null>(null)
  const orientationPermission = useRef<SensorPermission>("unknown")
  const motionPermission = useRef<SensorPermission>("unknown")
  const [replayKey, setReplayKey] = useState(0)
  const [isDropping, setIsDropping] = useState(false)

  const removeSensorListeners = useCallback((runtime: GravityRuntime) => {
    if (typeof window === "undefined") return
    if (runtime.orientationListener) window.removeEventListener("deviceorientation", runtime.orientationListener)
    if (runtime.motionListener) window.removeEventListener("devicemotion", runtime.motionListener)
    runtime.orientationListener = undefined
    runtime.motionListener = undefined
    runtime.sensorActive = false
  }, [])

  const installSensorListeners = useCallback((runtime: GravityRuntime) => {
    if (typeof window === "undefined" || runtime.reducedMotion) return

    const orientationSupported = typeof window.DeviceOrientationEvent !== "undefined"
    const motionSupported = typeof window.DeviceMotionEvent !== "undefined"
    const orientationReady = orientationSupported && orientationPermission.current !== "denied" && orientationPermission.current !== "unsupported" && (orientationPermission.current === "granted" || !sensorConstructor("orientation")?.requestPermission)
    const motionReady = motionSupported && motionPermission.current !== "denied" && motionPermission.current !== "unsupported" && (motionPermission.current === "granted" || !sensorConstructor("motion")?.requestPermission)

    if (orientationReady && !runtime.orientationListener) {
      const listener = (event: DeviceOrientationEvent) => {
        if (event.beta === null || event.gamma === null) return
        const next = shelfGravityFromOrientation(event.beta, event.gamma, screenOrientationAngle())
        const delta = Math.hypot(next.x - runtime.gravityTarget.x, next.y - runtime.gravityTarget.y)
        runtime.gravityTarget = next
        if (delta > .018) wakeBodies(runtime.bodies)
        runtime.restart?.()
      }
      runtime.orientationListener = listener
      window.addEventListener("deviceorientation", listener, { passive: true })
    }

    if (motionReady && !runtime.motionListener) {
      const listener = (event: DeviceMotionEvent) => {
        if (!isSignificantMotion(event)) return
        const now = performance.now()
        if (now - runtime.lastShakeAt < shakeThrottleMs) return
        runtime.lastShakeAt = now
        const strength = clamp(motionAccelerationMagnitude(event) / 14, 0, 1)
        // A shake should be felt, but remain well below the velocity cap so
        // the boundary bodies can absorb it without ejecting a sticker.
        const velocityImpulse = .028 + strength * .05
        for (const { body } of runtime.bodies) {
          const angle = Math.random() * Math.PI * 2
          const nextVelocity = {
            x: clamp(body.velocity.x + Math.cos(angle) * velocityImpulse, -.7, .7),
            y: clamp(body.velocity.y + Math.sin(angle) * velocityImpulse, -.7, .7),
          }
          Body.setVelocity(body, nextVelocity)
          Sleeping.set(body, false)
        }
        runtime.restart?.()
      }
      runtime.motionListener = listener
      window.addEventListener("devicemotion", listener, { passive: true })
    }

    runtime.sensorActive = Boolean(runtime.orientationListener ?? runtime.motionListener)
    runtime.restart?.()
  }, [])

  const stopGravity = useCallback(() => {
    if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current)
    animationFrame.current = null
    const runtime = runtimeRef.current
    if (runtime) {
      removeSensorListeners(runtime)
      Composite.clear(runtime.engine.world, false, true)
      Engine.clear(runtime.engine)
      runtimeRef.current = null
    }
  }, [removeSensorListeners])

  const startGravityDrop = useCallback((replay: boolean) => {
    stopGravity()
    const shelf = shelfRef.current
    if (!shelf) return

    const stickers = [...shelf.querySelectorAll<HTMLButtonElement>(".gravity-sticker")]
    if (!stickers.length) {
      setIsDropping(false)
      return
    }

    shelf.style.removeProperty("--gravity-shelf-height")
    const availableHeight = shelf.clientHeight
    // The shelf is a physical viewport, not a scrollable gallery. Keep its
    // world exactly inside the stage even for a dense pile; Matter resolves
    // the crowding by stacking bodies instead of stretching the container.
    shelf.style.setProperty("--gravity-shelf-height", `${availableHeight}px`)
    shelf.dataset.gravityScrollable = "false"

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    const bounds = shelf.getBoundingClientRect()
    const width = Math.max(1, Math.round(bounds.width))
    const height = Math.max(1, Math.round(bounds.height))
    const engine = Engine.create({
      enableSleeping: true,
      gravity: { x: 0, y: 1, scale: .0024 },
      positionIterations: 12,
      velocityIterations: 10,
    })
    const runtime: GravityRuntime = {
      engine,
      bodies: [],
      floor: null,
      gravityCurrent: { x: 0, y: 1 },
      gravityTarget: { x: 0, y: 1 },
      reducedMotion,
      sensorActive: false,
      settled: false,
      lastShakeAt: -Infinity,
      orientationListener: undefined,
      motionListener: undefined,
    }
    runtimeRef.current = runtime

    // The physical circle may be smaller than a rectangular sticker's visual
    // footprint. These insets reserve room for its outline and slight tilt.
    // Keep only a small visual breathing room at the wall. The body's circle
    // radius already reserves the sticker's visible footprint, so a larger
    // inset creates unusable-looking gutters along both sides of the shelf.
    const edgeInset = 10
    const floorInset = 24
    const wallThickness = 32
    const floor = Bodies.rectangle(width / 2, height - floorInset + wallThickness / 2, width + wallThickness * 2, wallThickness, { isStatic: true, friction: .98, restitution: .01 })
    runtime.floor = floor
    const walls = [
      floor,
      // Side walls guide a sticker but are deliberately frictionless. Static
      // wall friction made one sticker cling and visibly crawl downward.
      Bodies.rectangle(edgeInset - wallThickness / 2, height / 2, wallThickness, height * 2, { isStatic: true, friction: 0, frictionStatic: 0, restitution: .01 }),
      Bodies.rectangle(width - edgeInset + wallThickness / 2, height / 2, wallThickness, height * 2, { isStatic: true, friction: 0, frictionStatic: 0, restitution: .01 }),
    ]
    runtime.bodies = stickers.map((element, index) => {
      const id = element.dataset.stickerId ?? ""
      const dimensions = gravityDimensions(id)
      const initial = gravityInitialState(id, index, width, height, false)
      const radius = Math.min(dimensions.width, dimensions.height) * .39
      const seed = stickerSeed(id)
      const body = Bodies.circle(initial.x + dimensions.width / 2, initial.y + dimensions.height / 2, radius, {
        density: .001 + (seed % 5) * .00004,
        friction: .42 + (seed % 4) * .025,
        frictionAir: .01,
        frictionStatic: .55,
        restitution: .02,
        // During the guarded initial drop below we prevent early sleeping.
        // This normal threshold still lets the final pile settle promptly.
        sleepThreshold: 30,
      })
      Body.setAngle(body, initial.angle * Math.PI / 180)
      Body.setVelocity(body, { x: initial.vx / 60, y: initial.vy * initialDropVelocityScale / 60 })
      return { body, element, height: dimensions.height, index, width: dimensions.width }
    })

    Composite.add(engine.world, [...walls, ...runtime.bodies.map(({ body }) => body)])
    const render = () => runtime.bodies.forEach(placeGravityBody)
    render()

    // Reduced-motion users receive a settled pile without sensor-driven movement.
    if (reducedMotion) {
      for (let step = 0; step < 300; step += 1) Engine.update(engine, 1000 / 120)
      stopBodies(runtime.bodies)
      runtime.settled = true
      render()
      setIsDropping(false)
      return
    }

    setIsDropping(true)
    const startedAt = performance.now()
    let lastFrame = startedAt
    let accumulator = 0
    let simulatedDuration = 0
    let settledSince: number | null = null
    // A tall phone shelf needs enough simulated time for the last spawned
    // item to reach the pile. This is a wake window, never a forced stop.
    const minimumDropDuration = replay ? 2200 : 2600
    const animate = (now: number) => {
      if (runtimeRef.current !== runtime) return
      const frameDuration = Math.min(100, Math.max(0, now - lastFrame))
      lastFrame = now
      accumulator = Math.min(accumulator + frameDuration, 100)
      let steps = 0
      while (accumulator >= 1000 / 120 && steps < 12) {
        runtime.gravityCurrent.x += (runtime.gravityTarget.x - runtime.gravityCurrent.x) * gravitySmoothing
        runtime.gravityCurrent.y += (runtime.gravityTarget.y - runtime.gravityCurrent.y) * gravitySmoothing
        engine.gravity.x = runtime.gravityCurrent.x
        engine.gravity.y = runtime.gravityCurrent.y
        // Matter's low-motion heuristic can sleep a spawned body before it
        // has accumulated enough gravity to descend. Keep the full set awake
        // only for the initial free-fall window, then hand settling back to
        // its contact-aware solver so the finished pile stays still.
        if (simulatedDuration < minimumDropDuration) wakeBodies(runtime.bodies)
        Engine.update(engine, 1000 / 120)
        // Matter can otherwise sleep an airborne body after a quiet collision
        // frame. Only supported bodies are allowed to become idle.
        keepUnsupportedBodiesAwake(runtime)
        accumulator -= 1000 / 120
        simulatedDuration += 1000 / 120
        steps += 1
      }

      render()
      const bodyList = runtime.bodies.map(({ body }) => body)
      const allSupported = runtime.bodies.every(({ body }) => isGravityBodySupported(body, runtime.floor, bodyList))
      if (!runtime.settled && allSupported && runtime.bodies.every(({ body }) => body.isSleeping)) settledSince ??= now
      else if (!runtime.settled) settledSince = null
      // Do not freeze the scene merely because a timer has elapsed. A sticker
      // that was nudged late in the drop could otherwise be stopped visibly
      // above the pile. Sleeping is Matter's contact-aware resting signal;
      // the longer fallback only handles an extremely quiet numerical wobble.
      const barelyMoving = runtime.bodies.every(({ body }) => body.speed < .04 && Math.abs(body.angularVelocity) < .002)
      const safetyTimeout = simulatedDuration > (replay ? 6000 : 8000)
      if (!runtime.settled && ((settledSince !== null && now - settledSince > 180) || (safetyTimeout && allSupported && barelyMoving))) {
        stopBodies(runtime.bodies)
        runtime.settled = true
        render()
        setIsDropping(false)
      }

      if (runtime.settled && !runtime.sensorActive) {
        animationFrame.current = null
        return
      }
      animationFrame.current = window.requestAnimationFrame(animate)
    }
    runtime.restart = () => {
      if (runtimeRef.current === runtime && animationFrame.current === null) {
        lastFrame = performance.now()
        animationFrame.current = window.requestAnimationFrame(animate)
      }
    }

    installSensorListeners(runtime)
    animationFrame.current ??= window.requestAnimationFrame(animate)
  }, [installSensorListeners, stopGravity])

  const requestMotionPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)) return false

    let requested = false
    let granted = false
    const request = async (name: "orientation" | "motion", permissionRef: { current: SensorPermission }) => {
      const constructor = sensorConstructor(name)
      if (!constructor) {
        permissionRef.current = "unsupported"
        return
      }
      if (typeof constructor.requestPermission !== "function") {
        permissionRef.current = "granted"
        granted = true
        return
      }
      requested = true
      try {
        const permission = await constructor.requestPermission()
        permissionRef.current = permission
        if (permission === "granted") granted = true
      } catch {
        permissionRef.current = "denied"
      }
    }
    // iOS keeps the click's user activation for only a very short time. Start
    // both prompts together so the second sensor is not rejected after the
    // first permission dialog resolves.
    await Promise.all([
      request("orientation", orientationPermission),
      request("motion", motionPermission),
    ])
    const runtime = runtimeRef.current
    if (runtime) installSensorListeners(runtime)
    return granted || (!requested && (orientationPermission.current === "granted" || motionPermission.current === "granted"))
  }, [installSensorListeners])

  useLayoutEffect(() => {
    const shelf = shelfRef.current
    if (!shelf || !stickerKey) {
      setIsDropping(false)
      return
    }
    startGravityDrop(replayKey > 0)
    return stopGravity
  }, [replayKey, startGravityDrop, stickerKey, stopGravity])

  const replay = useCallback(() => setReplayKey((value) => value + 1), [])

  useEffect(() => () => stopGravity(), [stopGravity])

  return { shelfRef, isDropping, replay, requestMotionPermission }
}
