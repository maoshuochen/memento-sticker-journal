import { FabricImage } from "fabric"

export const STICKER_SOURCE_SIZE = 512
export const STICKER_BASE_SIZE = 116

function browserBaseUrl(): string {
  return typeof window === "undefined" ? "http://localhost/" : window.location.href
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function stickerOutlineFilter(
  edgeThickness: number,
  sourceCoordinateSize = STICKER_SOURCE_SIZE,
  targetSize = STICKER_BASE_SIZE,
): string {
  // Express the desired edge in final canvas pixels before converting it to
  // the source coordinate system.  This keeps raster and SVG stickers at the
  // same visual weight when their source dimensions differ.
  const visualEdge = Math.max(4, Math.min(8, edgeThickness * 1.5))
  const radius = Math.max(.4, Math.round(visualEdge * sourceCoordinateSize / Math.max(1, targetSize) * 10) / 10)
  return `
    <filter id="sticker-outline" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feMorphology in="SourceAlpha" operator="dilate" radius="${radius}" result="expanded" />
      <feFlood flood-color="#fffdf7" flood-opacity="1" result="outlineColor" />
      <feComposite in="outlineColor" in2="expanded" operator="in" result="outline" />
      <feMerge>
        <feMergeNode in="outline" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>`
}

function wrapImageWithStickerOutline(source: string, edgeThickness: number, targetSize: number): string {
  const safeSource = escapeXmlAttribute(new URL(source, browserBaseUrl()).href)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STICKER_SOURCE_SIZE}" height="${STICKER_SOURCE_SIZE}" viewBox="0 0 ${STICKER_SOURCE_SIZE} ${STICKER_SOURCE_SIZE}"><defs>${stickerOutlineFilter(edgeThickness, STICKER_SOURCE_SIZE, targetSize)}</defs><image href="${safeSource}" x="0" y="0" width="${STICKER_SOURCE_SIZE}" height="${STICKER_SOURCE_SIZE}" preserveAspectRatio="xMidYMid meet" filter="url(#sticker-outline)" /></svg>`
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read sticker image"))
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Unable to read sticker image"))
    reader.readAsDataURL(blob)
  })
}

async function inlineRasterSource(source: string): Promise<string> {
  // Private assets are represented by blob URLs.  Embed their bytes before
  // handing the wrapper SVG to Fabric so nested blob URLs work in WebViews.
  if (source.startsWith("data:")) return source
  const response = await fetch(source)
  if (!response.ok) throw new Error("Unable to load sticker image")
  return blobAsDataUrl(await response.blob())
}

/**
 * Fetch and rasterize a sticker source for Fabric.  SVGs get normalized to a
 * square viewport so a missing width/height does not become Fabric's 300x150
 * fallback.  If the outlined wrapper is rejected, the original source is
 * tried once so older browsers still render the asset.
 */
export async function fabricImageFromSource(source: string, edgeThickness: number, targetSize: number): Promise<FabricImage> {
  const url = new URL(source, browserBaseUrl())
  try {
    let outlinedSvg: string
    if (url.pathname.endsWith(".svg")) {
      const response = await fetch(source)
      if (!response.ok) throw new Error("Unable to load SVG")
      const svg = await response.text()
      const openingTag = /<svg\b[^>]*>/.exec(svg)?.[0]
      const closingIndex = svg.lastIndexOf("</svg>")
      if (!openingTag || closingIndex < 0) throw new Error("Invalid SVG")
      const body = svg.slice(openingTag.length, closingIndex)
      const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(openingTag)?.[1] ?? `0 0 ${STICKER_SOURCE_SIZE} ${STICKER_SOURCE_SIZE}`
      const viewBoxValues = viewBox.trim().split(/[\s,]+/).map(Number)
      const viewBoxWidth = viewBoxValues[2] ?? 0
      const sourceCoordinateSize = Number.isFinite(viewBoxWidth) && viewBoxWidth > 0 ? viewBoxWidth : STICKER_SOURCE_SIZE
      const normalizedOpeningTag = `<svg xmlns="http://www.w3.org/2000/svg" width="${STICKER_SOURCE_SIZE}" height="${STICKER_SOURCE_SIZE}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">`
      outlinedSvg = `${normalizedOpeningTag}<defs>${stickerOutlineFilter(edgeThickness, sourceCoordinateSize, targetSize)}</defs><g filter="url(#sticker-outline)">${body}</g></svg>`
    } else {
      outlinedSvg = wrapImageWithStickerOutline(await inlineRasterSource(source), edgeThickness, targetSize)
    }
    const objectUrl = URL.createObjectURL(new Blob([outlinedSvg], { type: "image/svg+xml" }))
    try {
      return await FabricImage.fromURL(objectUrl)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch (cause) {
    try {
      return await FabricImage.fromURL(source, { crossOrigin: "anonymous" })
    } catch {
      throw cause instanceof Error ? cause : new Error("Unable to decode sticker image")
    }
  }
}
