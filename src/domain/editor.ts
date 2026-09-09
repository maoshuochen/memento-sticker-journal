import type { CanvasDocument, CanvasHistory, CanvasObject, CanvasStickerObject, CanvasTapeStyle, CanvasTextFont, PageHistory, Placement } from "@/domain/model"
import { CANVAS_TAPE_ICON_COLORS, TAPE_BACKGROUND_COLORS, defaultTapeIconColor } from "@/domain/tapePatterns"

export const LEGACY_CANVAS_WIDTH = 640
export const LEGACY_CANVAS_HEIGHT = 640
const LEGACY_STICKER_SIZE = 116

export const DEFAULT_CANVAS_TEXT_COLOR = "#3d3028"
export const DEFAULT_CANVAS_TEXT_FONT: CanvasTextFont = "serif"
export const DEFAULT_CANVAS_TEXT_WEIGHT = 400 as const
export const CANVAS_TEXT_WEIGHTS = [
  { value: 400, label: "常规" },
  { value: 500, label: "中等" },
  { value: 600, label: "半粗" },
  { value: 700, label: "粗体" },
] as const
export const CANVAS_TEXT_COLORS = [
  DEFAULT_CANVAS_TEXT_COLOR,
  "#9a6547",
  "#b95757",
  "#6c7957",
  "#66768a",
] as const

// Keep the original editor exports stable while the catalogue lives beside
// the persisted tape pattern definitions.  Existing pages and callers can
// continue importing CANVAS_TAPE_COLORS from this module.
export const CANVAS_TAPE_COLORS = TAPE_BACKGROUND_COLORS
export { CANVAS_TAPE_ICON_COLORS, defaultTapeIconColor }

export const DEFAULT_CANVAS_TAPE_COLOR = CANVAS_TAPE_COLORS[0]
export const DEFAULT_CANVAS_TAPE_ICON_COLOR = defaultTapeIconColor(DEFAULT_CANVAS_TAPE_COLOR)

export function normalizeCanvasTapeStyle(style: CanvasTapeStyle | undefined): CanvasTapeStyle {
  if (!style) return { color: DEFAULT_CANVAS_TAPE_COLOR }
  if (style.pattern?.kind === "icon") {
    return { color: style.color, pattern: { ...style.pattern } }
  }
  if (style.pattern?.kind === "emoji") {
    return { color: style.color, pattern: { ...style.pattern } }
  }
  return { color: style.color }
}

export const CANVAS_TEXT_FONTS = [
  { id: "handwritten", label: "手绘", description: "随手写下", family: '"ZCOOL KuaiLe", "Comic Sans MS", cursive' },
  { id: "yozai", label: "悠哉", description: "自然笔迹", family: '"Yozai", "STKaiti", KaiTi, cursive' },
  { id: "serif", label: "衬线", description: "书页感", family: '"Iowan Old Style", "Noto Serif CJK SC", "Songti SC", STSong, Georgia, serif' },
  { id: "sans", label: "无衬线", description: "清爽清晰", family: '"Geist Variable", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif' },
] as const satisfies readonly { id: CanvasTextFont; label: string; description: string; family: string }[]

export function canvasTextFontLoadDescriptor(font: CanvasTextFont | undefined): string | null {
  if (font === "handwritten") return '400 32px "ZCOOL KuaiLe"'
  if (font === "yozai") return '400 32px "Yozai"'
  return null
}

export function canvasTextFontFamily(font: CanvasTextFont | undefined): string {
  return CANVAS_TEXT_FONTS.find((option) => option.id === (font ?? DEFAULT_CANVAS_TEXT_FONT))?.family
    ?? CANVAS_TEXT_FONTS[1].family
}

export function emptyCanvasDocument(): CanvasDocument {
  return { version: 1, objects: [] }
}

export function cloneCanvasDocument(document: CanvasDocument): CanvasDocument {
  return structuredClone(document)
}

export function stickerIdFromPlacement(id: string): string {
  return id.split("::", 1)[0] ?? id
}

export function canvasDocumentFromPlacements(placements: Placement[]): CanvasDocument {
  const minDimension = Math.min(LEGACY_CANVAS_WIDTH, LEGACY_CANVAS_HEIGHT)
  const objects: CanvasStickerObject[] = placements.map((placement) => {
    const visualSize = LEGACY_STICKER_SIZE * placement.scale
    return {
      id: placement.id,
      kind: "sticker",
      stickerId: stickerIdFromPlacement(placement.id),
      x: Math.min(1, Math.max(0, (placement.left + visualSize / 2) / LEGACY_CANVAS_WIDTH)),
      y: Math.min(1, Math.max(0, (placement.top + visualSize / 2) / LEGACY_CANVAS_HEIGHT)),
      size: Math.min(1, Math.max(0.04, visualSize / minDimension)),
      angle: normalizeAngle(placement.angle),
      zIndex: placement.zIndex
    }
  })
  return { version: 1, objects }
}

export function pointerAngle(centerX: number, centerY: number, pointerX: number, pointerY: number): number {
  return Math.atan2(pointerY - centerY, pointerX - centerX) * 180 / Math.PI
}

export function shortestAngleDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

export function normalizeAngle(angle: number): number {
  const normalized = ((angle + 180) % 360 + 360) % 360 - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

export function appendHistory(history: PageHistory, placements: Placement[], limit = 30): PageHistory {
  const entries = history.entries.slice(0, history.index + 1)
  entries.push(placements)
  if (entries.length > limit) entries.splice(0, entries.length - limit)
  return { entries, index: entries.length - 1 }
}

export function moveHistory(
  history: PageHistory,
  direction: -1 | 1,
): { history: PageHistory; placements: Placement[] } | null {
  const index = history.index + direction
  const placements = history.entries[index]
  if (!placements) return null
  return { history: { ...history, index }, placements }
}

export function appendCanvasHistory(history: CanvasHistory, document: CanvasDocument, limit = 30): CanvasHistory {
  const entries = history.entries.slice(0, history.index + 1)
  entries.push(cloneCanvasDocument(document))
  if (entries.length > limit) entries.splice(0, entries.length - limit)
  return { entries, index: entries.length - 1 }
}

export function moveCanvasHistory(
  history: CanvasHistory,
  direction: -1 | 1,
): { history: CanvasHistory; document: CanvasDocument } | null {
  const index = history.index + direction
  const document = history.entries[index]
  if (!document) return null
  return { history: { ...history, index }, document: cloneCanvasDocument(document) }
}

export function nextCanvasZIndex(objects: CanvasObject[]): number {
  return Math.max(0, ...objects.map((object) => object.zIndex)) + 1
}
