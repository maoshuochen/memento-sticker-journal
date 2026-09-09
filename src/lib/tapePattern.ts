import type { CanvasTapeStyle } from "@/domain/model"
import { TAPE_ICON_BY_ID, type TapeIconNode } from "@/domain/tapePatterns"

export const TAPE_PATTERN_GLYPH_RATIO = 0.62
export const TAPE_PATTERN_CELL_RATIO = 1.35

const tileCache = new Map<string, HTMLCanvasElement>()

function rgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

function drawIconNode(context: CanvasRenderingContext2D, node: TapeIconNode, filled: boolean): void {
  const path = new Path2D()
  context.beginPath()
  if (node.type === "path") path.addPath(new Path2D(node.d))
  else if (node.type === "circle") path.arc(node.cx, node.cy, node.r, 0, Math.PI * 2)
  else if (node.type === "line") {
    path.moveTo(node.x1, node.y1)
    path.lineTo(node.x2, node.y2)
  } else if (node.type === "rect") {
    path.roundRect(node.x, node.y, node.width, node.height, node.rx ?? node.ry ?? 0)
  } else {
    const coordinates = node.points.trim().split(/[\s,]+/).map(Number)
    for (let index = 0; index < coordinates.length; index += 2) {
      const x = coordinates[index] ?? 0
      const y = coordinates[index + 1] ?? 0
      if (index === 0) path.moveTo(x, y)
      else path.lineTo(x, y)
    }
    if (node.type === "polygon") path.closePath()
  }
  context.save()
  context.globalAlpha = node.opacity ?? 1
  context.lineWidth = filled ? 1.35 : (node.strokeWidth ?? 2)
  context.lineCap = node.strokeLinecap ?? "round"
  context.lineJoin = node.strokeLinejoin ?? "round"
  const canFill = node.type !== "line" && node.type !== "polyline"
  if ((filled && canFill) || (node.fill && node.fill !== "none")) context.fill(path, node.fillRule ?? "nonzero")
  if (node.stroke !== "none" && (node.stroke || !node.fill)) context.stroke(path)
  context.restore()
}

export function tapePatternRepeatCount(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0
  return Math.max(1, Math.ceil(width / (height * TAPE_PATTERN_CELL_RATIO)))
}

export function tapePatternOffset(width: number, tileWidth: number): number {
  if (width <= 0 || tileWidth <= 0) return 0
  const remainder = width % tileWidth
  return remainder === 0 ? 0 : -(tileWidth - remainder) / 2
}

export function createTapePatternTile(style: CanvasTapeStyle, height: number): HTMLCanvasElement | null {
  if (!style.pattern || typeof document === "undefined") return null
  const tileHeight = Math.max(16, Math.round(height))
  const cacheKey = `${style.color}:${JSON.stringify(style.pattern)}:${tileHeight}`
  const cached = tileCache.get(cacheKey)
  if (cached) return cached
  const tile = document.createElement("canvas")
  tile.height = tileHeight
  tile.width = Math.max(tileHeight, Math.round(tileHeight * TAPE_PATTERN_CELL_RATIO))
  const context = tile.getContext("2d")
  if (!context) return null
  context.fillStyle = rgba(style.color, 0.72)
  context.fillRect(0, 0, tile.width, tile.height)
  const glyphSize = tile.height * TAPE_PATTERN_GLYPH_RATIO
  if (style.pattern.kind === "emoji") {
    context.font = `${glyphSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(style.pattern.value, tile.width / 2, tile.height / 2 + tile.height * 0.025)
  } else {
    const icon = TAPE_ICON_BY_ID.get(style.pattern.id)
    if (!icon) return null
    context.save()
    context.translate((tile.width - glyphSize) / 2, (tile.height - glyphSize) / 2)
    context.scale(glyphSize / 24, glyphSize / 24)
    context.strokeStyle = style.pattern.color
    context.fillStyle = style.pattern.color
    context.lineWidth = 2
    context.lineCap = "round"
    context.lineJoin = "round"
    for (const node of icon.nodes) drawIconNode(context, node, style.pattern.style === "filled")
    context.restore()
  }
  tileCache.set(cacheKey, tile)
  return tile
}
