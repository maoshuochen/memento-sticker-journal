export interface GravityDimensions {
  width: number
  height: number
}

export interface GravityInitialState {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  spin: number
}

export function stickerSeed(value: string): number {
  return [...value].reduce((seed, character) => ((seed * 31) + character.charCodeAt(0)) >>> 0, 7)
}

export function gravityDimensions(id: string): GravityDimensions {
  void id
  return {
    width: 84,
    height: 90,
  }
}

export function gravityColumnCount(width: number): number {
  return width >= 310 ? 3 : 2
}

export function gravityShelfHeight(count: number, width: number, availableHeight: number): number {
  const rows = Math.ceil(Math.max(1, count) / gravityColumnCount(width))
  return Math.max(availableHeight, 30 + rows * 98)
}

export function gravityInitialState(id: string, index: number, width: number, height: number, reducedMotion: boolean): GravityInitialState {
  const seed = stickerSeed(id)
  const horizontalRange = Math.max(1, width - gravityDimensions(id).width - 8)
  // A golden-ratio stride spreads consecutive stickers across the full shelf
  // instead of repeatedly dropping the whole pile into its centre. The small
  // ID-based offset keeps each collection deterministic without excluding the
  // usable areas near either wall.
  const horizontalPosition = ((index * .61803398875) + ((seed % 251) / 251)) % 1
  return {
    x: 4 + horizontalPosition * horizontalRange,
    y: reducedMotion ? Math.max(0, height - gravityDimensions(id).height - 7 - (index % 3) * 5) : -gravityDimensions(id).height - index * 4,
    vx: ((seed % 9) - 4) * 10,
    vy: reducedMotion ? 0 : 20 + (index % 3) * 35,
    angle: ((seed % 13) - 6) * 1.4,
    spin: ((seed % 7) - 3) * .13,
  }
}
