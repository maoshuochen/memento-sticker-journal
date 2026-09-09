import type { CanvasDocument, CanvasObject, CanvasTapeObject } from "@/domain/model"
import { DEFAULT_CANVAS_TEXT_COLOR, DEFAULT_CANVAS_TEXT_FONT } from "@/domain/editor"

/**
 * Canvas records can be produced by IndexedDB, sync responses, or Fabric's
 * serializer.  Keep one stable shape for comparisons and persistence so a
 * live-query acknowledgement cannot be mistaken for a new edit.
 */
export function normalizeCanvasDocument(document: CanvasDocument): CanvasDocument {
  return {
    version: 1,
    objects: document.objects.map((object): CanvasObject => {
      if (object.kind === "sticker") {
        return {
          id: object.id,
          kind: "sticker",
          stickerId: object.stickerId,
          x: object.x,
          y: object.y,
          size: object.size,
          angle: object.angle,
          zIndex: object.zIndex,
        }
      }
      if (object.kind === "tape") {
        const normalizedTape: CanvasTapeObject = {
          id: object.id,
          kind: "tape",
          color: object.color,
          x: object.x,
          y: object.y,
          width: object.width,
          height: object.height,
          angle: object.angle,
          zIndex: object.zIndex,
        }
        return object.pattern ? { ...normalizedTape, pattern: structuredClone(object.pattern) } : normalizedTape
      }
      return {
        id: object.id,
        kind: "text",
        text: object.text,
        color: object.color ?? DEFAULT_CANVAS_TEXT_COLOR,
        font: object.font ?? DEFAULT_CANVAS_TEXT_FONT,
        x: object.x,
        y: object.y,
        width: object.width,
        fontSize: object.fontSize,
        angle: object.angle,
        zIndex: object.zIndex,
      }
    }),
  }
}

export function canvasDocumentKey(document: CanvasDocument): string {
  return JSON.stringify(normalizeCanvasDocument(document))
}
