import { Canvas, Rect, Shadow, Textbox, type FabricObject } from "fabric"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"

import type { CanvasDocument, CanvasObject, CanvasStickerObject, CanvasTapeObject, CanvasTextFont, CanvasTextObject, StickerRecord } from "@/domain/model"
import { canvasTextFontFamily, canvasTextFontLoadDescriptor, DEFAULT_CANVAS_TAPE_COLOR, DEFAULT_CANVAS_TEXT_COLOR, DEFAULT_CANVAS_TEXT_FONT, nextCanvasZIndex } from "@/domain/editor"
import { canvasDocumentKey, normalizeCanvasDocument } from "@/domain/canvasDocument"
import type { CanvasOperationToken } from "@/hooks/useCanvasHistory"
import { fabricImageFromSource, STICKER_BASE_SIZE } from "@/lib/canvasImages"

const TEXT_COLOR = DEFAULT_CANVAS_TEXT_COLOR

type RuntimeObject = FabricObject & { memento?: CanvasObject; missingAsset?: boolean }
type CanvasSize = { width: number; height: number }
export type CanvasSelectionAnchor = { x: number; y: number; placement: "above" | "below" }

export interface CanvasRenderState {
  pageId: string | null;
  loading: boolean;
  complete: boolean;
  hasErrors: boolean;
  errorMessage?: string | undefined;
}

export interface FabricJournalCanvasHandle {
  isReadyForExport(): boolean;
  addSticker(stickerId: string): void;
  addTape(color?: string): void;
  addText(): void;
  setSelectedTextColor(color: string): void;
  setSelectedTextFont(font: CanvasTextFont): void;
  deleteSelected(): void;
  bringSelectedForward(): void;
  sendSelectedBackward(): void;
}

interface FabricJournalCanvasProps {
  pageId: string | null;
  document: CanvasDocument;
  stickers: StickerRecord[];
  assetUrls: ReadonlyMap<string, string>;
  readOnly?: boolean;
  acknowledgedOperation?: CanvasOperationToken | null;
  nextOperation(pageId: string, documentKey: string): CanvasOperationToken;
  onCommit(document: CanvasDocument, operation: CanvasOperationToken): void;
  onRenderStateChange?(state: CanvasRenderState): void;
  onSelectedIdChange(id: string | null): void;
  onSelectedObjectChange?(object: CanvasObject | null): void;
  onSelectedAnchorChange?(anchor: CanvasSelectionAnchor | null): void;
}

function objectId(object: FabricObject | undefined): string | null {
  return (object as RuntimeObject | undefined)?.memento?.id ?? null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function objectCenter(object: FabricObject): { x: number; y: number } {
  const center = object.getCenterPoint()
  return { x: center.x, y: center.y }
}

export const FabricJournalCanvas = forwardRef<FabricJournalCanvasHandle, FabricJournalCanvasProps>(function FabricJournalCanvas(
  { pageId, document, stickers, assetUrls, acknowledgedOperation = null, nextOperation, onCommit, onRenderStateChange, onSelectedIdChange, onSelectedObjectChange, onSelectedAnchorChange, readOnly = false },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasElementRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const documentRef = useRef(document)
  const pageIdRef = useRef(pageId)
  const pageSessionRef = useRef(0)
  const pendingImagesRef = useRef(0)
  if (pageIdRef.current !== pageId) {
    pageIdRef.current = pageId
    pageSessionRef.current += 1
    pendingImagesRef.current = 0
  }
  // Keep imperative actions aligned with the latest render.  A passive effect
  // is too late when an image promise resolves during a page transition.
  documentRef.current = document
  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0 })
  const callbacksRef = useRef({ nextOperation, onCommit, onRenderStateChange, onSelectedIdChange, onSelectedObjectChange, onSelectedAnchorChange, readOnly })
  // Saving a movement updates the page record, which rehydrates the Fabric
  // objects. Keep the semantic selection outside Fabric so that rehydration
  // does not make a completed drag look like a deselect.
  const selectedObjectIdRef = useRef<string | null>(null)
  const isHydratingRef = useRef(false)
  // Fabric is the immediate source of truth while the user is manipulating an
  // object. A local save must not rebuild that same canvas from IndexedDB a
  // moment later: image decoding during that rebuild is the visible flash.
  const renderedDocumentKeyRef = useRef<string | null>(null)
  const renderedSourceKeyRef = useRef<string | null>(null)
  const renderedPageIdRef = useRef<string | null>(null)
  const latestCommitRef = useRef<CanvasOperationToken | null>(null)
  const loadSessionRef = useRef(0)
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })
  const [loading, setLoading] = useState(true)
  const loadingRef = useRef(true)
  const [loadIssues, setLoadIssues] = useState<Array<{ objectId: string; message: string }>>([])
  const loadIssuesRef = useRef(loadIssues)
  const [retryToken, setRetryToken] = useState(0)

  const stickerById = useMemo(() => new Map(stickers.map((sticker) => [sticker.id, sticker])), [stickers])
  const sourceKey = useMemo(() => document.objects
    .filter((object): object is CanvasStickerObject => object.kind === "sticker")
    .map((object) => `${object.id}:${assetUrls.get(stickerById.get(object.stickerId)?.assetId ?? "") ?? ""}`)
    .join("|"), [assetUrls, document.objects, stickerById])
  const documentKey = useMemo(() => canvasDocumentKey(document), [document])

  useEffect(() => { callbacksRef.current = { nextOperation, onCommit, onRenderStateChange, onSelectedIdChange, onSelectedObjectChange, onSelectedAnchorChange, readOnly } }, [nextOperation, onCommit, onRenderStateChange, onSelectedIdChange, onSelectedObjectChange, onSelectedAnchorChange, readOnly])

  const selectionAnchor = useCallback((selected?: FabricObject): CanvasSelectionAnchor | null => {
    const canvas = fabricCanvasRef.current
    const metadata = (selected as RuntimeObject | undefined)?.memento
    if (!canvas || !selected || !metadata || !canvas.width || !canvas.height) return null
    selected.setCoords()
    const bounds = selected.getBoundingRect()
    const toolbarHeight = 48
    // Fabric's rotation handle rises above the top edge of a selected object.
    // Keep the contextual bar beyond that handle, rather than turning the
    // very first transform affordance into an accidental toolbar tap.
    const rotationHandleClearance = 60
    const toolbarHalfWidth = metadata.kind === "text" ? 170 : 86
    const horizontalInset = Math.min(toolbarHalfWidth + 10, canvas.width / 2)
    const centerX = clamp(bounds.left + bounds.width / 2, horizontalInset, canvas.width - horizontalInset)
    const canSitAbove = bounds.top >= toolbarHeight + rotationHandleClearance + 12
    if (canSitAbove) {
      return { x: centerX, y: bounds.top - rotationHandleClearance, placement: "above" }
    }
    return {
      x: centerX,
      y: Math.min(canvas.height - toolbarHeight - 8, bounds.top + bounds.height + 10),
      placement: "below",
    }
  }, [])

  const reportSelection = useCallback((id: string | null, selected?: FabricObject): void => {
    // `canvas.clear()` emits selection:cleared while a persisted document is
    // being projected back into Fabric. That event is an implementation detail,
    // not a user intent to deselect.
    if (isHydratingRef.current) return
    selectedObjectIdRef.current = id
    callbacksRef.current.onSelectedIdChange(id)
    const activeObject = selected ?? (id ? fabricCanvasRef.current?.getActiveObject() : undefined)
    callbacksRef.current.onSelectedObjectChange?.((activeObject as RuntimeObject | undefined)?.memento ?? null)
    callbacksRef.current.onSelectedAnchorChange?.(selectionAnchor(activeObject))
  }, [selectionAnchor])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      if (!width || !height) return
      sizeRef.current = { width, height }
      setSize({ width, height })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const constrainObject = useCallback((object: FabricObject, canvas: Canvas): void => {
    const { width, height } = canvas
    const minDimension = Math.min(width, height)
    const metadata = (object as RuntimeObject).memento
    if (metadata?.kind === "tape") {
      const maximumWidth = width * .94
      const maximumHeight = height * .14
      if (object.getScaledWidth() > maximumWidth) object.scaleX = (object.scaleX ?? 1) * maximumWidth / object.getScaledWidth()
      if (object.getScaledHeight() > maximumHeight) object.scaleY = (object.scaleY ?? 1) * maximumHeight / object.getScaledHeight()
    } else {
      const maximum = minDimension * 0.82
      const visualSize = Math.max(object.getScaledWidth(), object.getScaledHeight())
      if (visualSize > maximum) {
        const ratio = maximum / visualSize
        object.scaleX = (object.scaleX ?? 1) * ratio
        object.scaleY = (object.scaleY ?? 1) * ratio
      }
    }
    object.setCoords()
    const bounds = object.getBoundingRect()
    // Stickers look more naturally placed when they can tuck under a page
    // edge. The paper still clips the artwork, while a soft 45% boundary
    // guarantees that enough remains on-page to pick it up again. Text and
    // tape keep their full containment because cut-off writing and strips
    // are harder to edit intentionally.
    const overflowX = metadata?.kind === "sticker" ? Math.min(bounds.width * .45, width * .22) : 0
    const overflowY = metadata?.kind === "sticker" ? Math.min(bounds.height * .45, height * .22) : 0
    if (bounds.left < -overflowX) object.left = (object.left ?? 0) - (bounds.left + overflowX)
    if (bounds.top < -overflowY) object.top = (object.top ?? 0) - (bounds.top + overflowY)
    if (bounds.left + bounds.width > width + overflowX) object.left = (object.left ?? 0) - (bounds.left + bounds.width - width - overflowX)
    if (bounds.top + bounds.height > height + overflowY) object.top = (object.top ?? 0) - (bounds.top + bounds.height - height - overflowY)
    object.setCoords()
  }, [])

  const fitTextWidth = useCallback((textbox: Textbox, canvas: Canvas): void => {
    // Fabric's Textbox treats `width` as a wrapping constraint. Giving new
    // and restored text a fixed width therefore leaves a large, unrelated
    // transform frame around short notes. First measure against the widest
    // safe line, then shrink the constraint to the actual longest line.
    const scaleX = textbox.scaleX ?? 1
    const maximumWidth = Math.max(28, canvas.width * .88 / scaleX)
    textbox.set({ width: maximumWidth })
    textbox.initDimensions()
    const contentWidth = textbox.textLines.reduce((widest, _line, index) => Math.max(widest, textbox.getLineWidth(index)), 0)
    const sideInset = Math.max(8, (textbox.fontSize ?? 24) * .25)
    textbox.set({ width: clamp(contentWidth + sideInset * 2, 18, maximumWidth) })
    textbox.initDimensions()
    textbox.setCoords()
  }, [])

  const serializeObject = useCallback((object: RuntimeObject, canvas: Canvas): CanvasObject | null => {
    const metadata = object.memento
    if (!metadata || !canvas.width || !canvas.height) return null
    if (object.missingAsset) return metadata
    const center = objectCenter(object)
    if (metadata.kind === "sticker") {
      return {
        ...metadata,
        x: clamp(center.x / canvas.width, 0, 1),
        y: clamp(center.y / canvas.height, 0, 1),
        size: clamp(Math.max(object.getScaledWidth(), object.getScaledHeight()) / Math.min(canvas.width, canvas.height), 0.04, 1),
        angle: Math.round((object.angle ?? 0) * 10) / 10,
      }
    }
    if (metadata.kind === "tape") {
      return {
        ...metadata,
        x: clamp(center.x / canvas.width, 0, 1),
        y: clamp(center.y / canvas.height, 0, 1),
        width: clamp(object.getScaledWidth() / canvas.width, 0.08, 0.94),
        height: clamp(object.getScaledHeight() / canvas.height, 0.02, 0.14),
        angle: Math.round((object.angle ?? 0) * 10) / 10,
      }
    }
    const textbox = object as Textbox
    return {
      ...metadata,
      text: textbox.text?.trim() || "write here",
      color: typeof textbox.fill === "string" ? textbox.fill : metadata.color ?? TEXT_COLOR,
      font: metadata.font ?? DEFAULT_CANVAS_TEXT_FONT,
      x: clamp(center.x / canvas.width, 0, 1),
      y: clamp(center.y / canvas.height, 0, 1),
      width: clamp(textbox.getScaledWidth() / canvas.width, 0.02, 0.9),
      fontSize: clamp(((textbox.fontSize ?? 24) * (textbox.scaleY ?? 1)) / Math.min(canvas.width, canvas.height), 0.02, 0.14),
      angle: Math.round((textbox.angle ?? 0) * 10) / 10,
    }
  }, [])

  const emitDocument = useCallback((canvas: Canvas): void => {
    if (callbacksRef.current.readOnly || isHydratingRef.current) return
    const activePageId = pageIdRef.current
    if (!activePageId) return
    const objects = canvas.getObjects()
      .map((object, zIndex) => {
        const serialized = serializeObject(object, canvas)
        return serialized ? { ...serialized, zIndex } : null
      })
      .filter((object): object is CanvasObject => object !== null)
    const nextDocument: CanvasDocument = { version: 1, objects }
    const nextDocumentKey = canvasDocumentKey(nextDocument)
    renderedDocumentKeyRef.current = nextDocumentKey
    const operation = callbacksRef.current.nextOperation(activePageId, nextDocumentKey)
    latestCommitRef.current = operation
    callbacksRef.current.onCommit(nextDocument, operation)
  }, [serializeObject])

  const makeMissingObject = useCallback((object: CanvasObject, canvas: Canvas): RuntimeObject => {
    const targetSize = object.kind === "sticker"
      ? Math.max(24, object.size * Math.min(canvas.width, canvas.height))
      : object.kind === "tape"
        ? Math.max(24, object.width * canvas.width)
        : Math.max(42, object.width * canvas.width)
    const placeholder = new Rect({
      left: object.x * canvas.width,
      top: object.y * canvas.height,
      originX: "center",
      originY: "center",
      width: targetSize,
      height: object.kind === "tape" ? Math.max(16, object.height * canvas.height) : targetSize,
      angle: object.angle,
      fill: "rgba(255, 253, 247, .56)",
      stroke: "rgba(154, 101, 71, .72)",
      strokeWidth: 2,
      strokeDashArray: [6, 5],
      cornerStyle: "circle",
      cornerColor: "#fffdf7",
      cornerStrokeColor: "#4b392f",
      borderColor: "#9a6547",
      transparentCorners: false,
      padding: 7,
    })
    ;(placeholder as RuntimeObject).memento = object
    ;(placeholder as RuntimeObject).missingAsset = true
    return placeholder
  }, [])

  const makeStickerObject = useCallback(async (object: CanvasStickerObject, canvas: Canvas): Promise<RuntimeObject> => {
    const sticker = stickerById.get(object.stickerId)
    const source = sticker ? assetUrls.get(sticker.assetId) : undefined
    if (!sticker) throw new Error("找不到贴纸资源。")
    if (!source) throw new Error("贴纸图片尚未下载完成。")
    const targetSize = object.size * Math.min(canvas.width, canvas.height)
    const image = await fabricImageFromSource(source, sticker.edgeThickness, targetSize)
    const longestSide = Math.max(image.width ?? 1, image.height ?? 1)
    image.set({
      left: object.x * canvas.width,
      top: object.y * canvas.height,
      originX: "center",
      originY: "center",
      angle: object.angle,
      scaleX: targetSize / longestSide,
      scaleY: targetSize / longestSide,
      lockScalingFlip: true,
      cornerStyle: "circle",
      cornerColor: "#fffdf7",
      cornerStrokeColor: "#4b392f",
      borderColor: "#9a6547",
      transparentCorners: false,
      padding: 7,
      shadow: new Shadow({ color: "rgba(61, 48, 40, .2)", blur: 2, offsetX: 0, offsetY: 3 }),
    })
    ;(image as RuntimeObject).memento = object
    return image
  }, [assetUrls, stickerById])

  const makeTextObject = useCallback((object: CanvasTextObject, canvas: Canvas): RuntimeObject => {
    const objectPageId = pageIdRef.current
    const objectSession = pageSessionRef.current
    const normalizedObject = normalizeCanvasDocument({ version: 1, objects: [object] }).objects[0]
    if (normalizedObject?.kind !== "text") {
      throw new Error("Unable to normalize canvas text")
    }
    const textbox = new Textbox(normalizedObject.text, {
      left: normalizedObject.x * canvas.width,
      top: normalizedObject.y * canvas.height,
      originX: "center",
      originY: "center",
      width: normalizedObject.width * canvas.width,
      fontSize: normalizedObject.fontSize * Math.min(canvas.width, canvas.height),
      fontFamily: canvasTextFontFamily(normalizedObject.font),
      fill: normalizedObject.color ?? TEXT_COLOR,
      angle: normalizedObject.angle,
      lockScalingFlip: true,
      cornerStyle: "circle",
      cornerColor: "#fffdf7",
      cornerStrokeColor: "#4b392f",
      borderColor: "#9a6547",
      transparentCorners: false,
      padding: 8,
    })
    ;(textbox as RuntimeObject).memento = normalizedObject
    fitTextWidth(textbox, canvas)
    const fontDescriptor = canvasTextFontLoadDescriptor(normalizedObject.font)
    if (fontDescriptor && typeof window !== "undefined") {
      void window.document.fonts?.load(fontDescriptor).then(() => {
        if (pageIdRef.current !== objectPageId || pageSessionRef.current !== objectSession) return
        fitTextWidth(textbox, canvas)
        textbox.initDimensions()
        textbox.setCoords()
        canvas.requestRenderAll()
      }).catch(() => undefined)
    }
    textbox.on("changed", () => {
      fitTextWidth(textbox, canvas)
      canvas.requestRenderAll()
    })
    textbox.on("editing:exited", () => {
      fitTextWidth(textbox, canvas)
      constrainObject(textbox, canvas)
      emitDocument(canvas)
    })
    return textbox
  }, [constrainObject, emitDocument, fitTextWidth])

  const makeTapeObject = useCallback((object: CanvasTapeObject, canvas: Canvas): RuntimeObject => {
    const tape = new Rect({
      left: object.x * canvas.width,
      top: object.y * canvas.height,
      originX: "center",
      originY: "center",
      width: object.width * canvas.width,
      height: object.height * canvas.height,
      fill: object.color,
      opacity: .72,
      rx: 1.5,
      ry: 1.5,
      stroke: "rgba(87, 63, 43, .16)",
      strokeWidth: .6,
      angle: object.angle,
      lockScalingY: true,
      lockScalingFlip: true,
      centeredScaling: true,
      cornerStyle: "circle",
      cornerColor: "#fffdf7",
      cornerStrokeColor: "#4b392f",
      borderColor: "#9a6547",
      transparentCorners: false,
      padding: 6,
      shadow: new Shadow({ color: "rgba(61, 48, 40, .15)", blur: 2, offsetX: 0, offsetY: 2 }),
    })
    // A strip is intentionally a one-dimensional direct manipulation: drag
    // it anywhere, rotate from Fabric's standard handle, and pull either end
    // to choose its length. Hiding the other controls prevents accidental
    // thickness changes on touch screens.
    tape.setControlsVisibility({ tl: false, tr: false, bl: false, br: false, mt: false, mb: false, ml: true, mr: true, mtr: true })
    ;(tape as RuntimeObject).memento = object
    return tape
  }, [])

  useEffect(() => {
    const element = canvasElementRef.current
    if (!element) return
    const canvas = new Canvas(element, { preserveObjectStacking: true, selection: false })
    canvas.uniformScaling = true
    canvas.on("selection:created", ({ selected }) => reportSelection(objectId(selected?.[0]), selected?.[0]))
    canvas.on("selection:updated", ({ selected }) => reportSelection(objectId(selected?.[0]), selected?.[0]))
    canvas.on("selection:cleared", () => reportSelection(null))
    const updateTransform = ({ target }: { target?: FabricObject }) => {
      if (!target) return
      constrainObject(target, canvas)
      callbacksRef.current.onSelectedAnchorChange?.(selectionAnchor(target))
    }
    canvas.on("object:moving", updateTransform)
    canvas.on("object:scaling", updateTransform)
    canvas.on("object:rotating", updateTransform)
    canvas.on("object:modified", () => emitDocument(canvas))
    fabricCanvasRef.current = canvas
    return () => {
      fabricCanvasRef.current = null
      void canvas.dispose()
    }
  }, [constrainObject, emitDocument, reportSelection, selectionAnchor])

  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    canvas.skipTargetFind = readOnly
    canvas.selection = false
    canvas.defaultCursor = readOnly ? "default" : "move"
  }, [readOnly])

  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas || !size.width || !size.height) return
    const dimensionsChanged = canvas.width !== size.width || canvas.height !== size.height
    const sourceChanged = renderedSourceKeyRef.current !== sourceKey
    const documentChanged = renderedDocumentKeyRef.current !== documentKey
    const pageChanged = renderedPageIdRef.current !== pageId
    const latestCommit = latestCommitRef.current
    const isAcknowledgedCommit = Boolean(
      acknowledgedOperation
      && latestCommit
      && acknowledgedOperation.pageId === pageId
      && latestCommit.pageId === pageId
      && acknowledgedOperation.sequence >= latestCommit.sequence
      && acknowledgedOperation.documentKey === documentKey,
    )
    // A persistence acknowledgement has no visual work to do: Fabric already
    // contains the exact live object. The page id and operation token prevent
    // an older page's live-query update from being treated as this page's ack.
    if (!pageChanged && !dimensionsChanged && !sourceChanged && (!documentChanged || isAcknowledgedCommit)) {
      loadingRef.current = false
      setLoading(false)
      callbacksRef.current.onRenderStateChange?.({ pageId, loading: false, complete: loadIssuesRef.current.length === 0, hasErrors: loadIssuesRef.current.length > 0, errorMessage: loadIssuesRef.current[0]?.message })
      return
    }
    let cancelled = false
    const session = ++loadSessionRef.current
    const selectedObjectId = selectedObjectIdRef.current
    loadingRef.current = true
    setLoading(true)
    loadIssuesRef.current = []
    setLoadIssues([])
    callbacksRef.current.onRenderStateChange?.({ pageId, loading: true, complete: false, hasErrors: false })
    isHydratingRef.current = true
    canvas.skipTargetFind = true
    canvas.setDimensions({ width: size.width, height: size.height })
    canvas.clear()
    const load = async () => {
      const issues: Array<{ objectId: string; message: string }> = []
      try {
        const loaded = await Promise.all(document.objects.map(async (object) => {
          try {
            if (object.kind === "sticker") return await makeStickerObject(object, canvas)
            if (object.kind === "tape") return makeTapeObject(object, canvas)
            return makeTextObject(object, canvas)
          } catch (cause) {
            issues.push({ objectId: object.id, message: cause instanceof Error ? cause.message : "资源加载失败。" })
            // Keep the semantic object in Fabric so a later edit cannot turn a
            // decode failure into an accidental deletion from the document.
            return makeMissingObject(object, canvas)
          }
        }))
        if (cancelled || session !== loadSessionRef.current) return
        for (const object of loaded.sort((left, right) => (left.memento?.zIndex ?? 0) - (right.memento?.zIndex ?? 0))) {
          canvas.add(object)
        }
        const restoredSelection = selectedObjectId
          ? canvas.getObjects().find((object) => objectId(object) === selectedObjectId)
          : undefined
        selectedObjectIdRef.current = restoredSelection ? selectedObjectId : null
        renderedPageIdRef.current = pageId
        renderedDocumentKeyRef.current = documentKey
        renderedSourceKeyRef.current = sourceKey
        if (restoredSelection) canvas.setActiveObject(restoredSelection)
        loadIssuesRef.current = issues
        setLoadIssues(issues)
        callbacksRef.current.onSelectedIdChange(selectedObjectIdRef.current)
        callbacksRef.current.onSelectedObjectChange?.(restoredSelection ? (restoredSelection as RuntimeObject).memento ?? null : null)
        callbacksRef.current.onSelectedAnchorChange?.(selectionAnchor(restoredSelection))
        canvas.requestRenderAll()
        callbacksRef.current.onRenderStateChange?.({ pageId, loading: false, complete: issues.length === 0, hasErrors: issues.length > 0, errorMessage: issues[0]?.message })
      } catch (cause) {
        if (cancelled || session !== loadSessionRef.current) return
        const message = cause instanceof Error ? cause.message : "画布加载失败。"
        const nextIssues = [...issues, { objectId: "canvas", message }]
        loadIssuesRef.current = nextIssues
        setLoadIssues(nextIssues)
        renderedPageIdRef.current = pageId
        renderedDocumentKeyRef.current = documentKey
        renderedSourceKeyRef.current = sourceKey
        callbacksRef.current.onRenderStateChange?.({ pageId, loading: false, complete: false, hasErrors: true, errorMessage: message })
      } finally {
        if (!cancelled && session === loadSessionRef.current) {
          isHydratingRef.current = false
          loadingRef.current = false
          canvas.skipTargetFind = callbacksRef.current.readOnly
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
      isHydratingRef.current = false
      loadingRef.current = false
      canvas.skipTargetFind = callbacksRef.current.readOnly
    }
  }, [acknowledgedOperation, document, documentKey, makeMissingObject, makeStickerObject, makeTapeObject, makeTextObject, pageId, retryToken, selectionAnchor, size, sourceKey])

  useImperativeHandle(ref, () => ({
    isReadyForExport() {
      if (loadingRef.current || pendingImagesRef.current || loadIssuesRef.current.length || renderedPageIdRef.current !== pageIdRef.current) return false
      return documentRef.current.objects.every((object) => {
        if (object.kind !== "text") return true
        const descriptor = canvasTextFontLoadDescriptor(object.font ?? DEFAULT_CANVAS_TEXT_FONT)
        return !descriptor || !window.document.fonts || window.document.fonts.check(descriptor)
      })
    },
    addSticker(stickerId: string) {
      if (callbacksRef.current.readOnly || loadingRef.current) return
      const canvas = fabricCanvasRef.current
      if (!canvas?.width || !canvas.height) return
      const requestedPageId = pageIdRef.current
      const requestedSession = pageSessionRef.current
      if (!requestedPageId) return
      const objects = documentRef.current.objects
      const index = objects.length % 4
      const object: CanvasStickerObject = {
        id: crypto.randomUUID(),
        kind: "sticker",
        stickerId,
        x: [0.32, 0.63, 0.44, 0.7][index] ?? 0.5,
        y: [0.3, 0.42, 0.62, 0.72][index] ?? 0.5,
        size: STICKER_BASE_SIZE / Math.min(canvas.width, canvas.height),
        angle: 0,
        zIndex: nextCanvasZIndex(objects),
      }
      pendingImagesRef.current += 1
      callbacksRef.current.onRenderStateChange?.({ pageId: requestedPageId, loading: true, complete: false, hasErrors: false })
      void makeStickerObject(object, canvas).then((fabricObject) => {
        if (pageIdRef.current !== requestedPageId || pageSessionRef.current !== requestedSession || fabricCanvasRef.current !== canvas) return
        canvas.add(fabricObject)
        canvas.setActiveObject(fabricObject)
        reportSelection(object.id)
        emitDocument(canvas)
        canvas.requestRenderAll()
      }).catch((cause: unknown) => {
        if (pageIdRef.current !== requestedPageId || pageSessionRef.current !== requestedSession || fabricCanvasRef.current !== canvas) return
        const issue = { objectId: object.id, message: cause instanceof Error ? cause.message : "贴纸图片加载失败。" }
        const nextIssues = [...loadIssuesRef.current.filter((item) => item.objectId !== object.id), issue]
        loadIssuesRef.current = nextIssues
        setLoadIssues(nextIssues)
        const placeholder = makeMissingObject(object, canvas)
        canvas.add(placeholder)
        canvas.setActiveObject(placeholder)
        reportSelection(object.id, placeholder)
        emitDocument(canvas)
        callbacksRef.current.onRenderStateChange?.({ pageId: requestedPageId, loading: false, complete: false, hasErrors: true, errorMessage: issue.message })
        canvas.requestRenderAll()
      }).finally(() => {
        if (pageIdRef.current !== requestedPageId || pageSessionRef.current !== requestedSession || fabricCanvasRef.current !== canvas) return
        pendingImagesRef.current = Math.max(0, pendingImagesRef.current - 1)
        callbacksRef.current.onRenderStateChange?.({ pageId: requestedPageId, loading: loadingRef.current || pendingImagesRef.current > 0, complete: !loadingRef.current && !pendingImagesRef.current && !loadIssuesRef.current.length, hasErrors: loadIssuesRef.current.length > 0 })
      })
    },
    addTape(color = DEFAULT_CANVAS_TAPE_COLOR) {
      if (callbacksRef.current.readOnly || loadingRef.current || !/^#[0-9a-fA-F]{6}$/.test(color)) return
      const canvas = fabricCanvasRef.current
      if (!canvas?.width || !canvas.height) return
      const object: CanvasTapeObject = {
        id: crypto.randomUUID(),
        kind: "tape",
        color,
        x: .5,
        y: .5,
        width: .36,
        height: .055,
        angle: -5,
        zIndex: nextCanvasZIndex(documentRef.current.objects),
      }
      const tape = makeTapeObject(object, canvas)
      canvas.add(tape)
      canvas.setActiveObject(tape)
      reportSelection(object.id, tape)
      emitDocument(canvas)
      canvas.requestRenderAll()
    },
    addText() {
      if (callbacksRef.current.readOnly || loadingRef.current) return
      const canvas = fabricCanvasRef.current
      if (!canvas?.width || !canvas.height) return
      const object: CanvasTextObject = {
        id: crypto.randomUUID(),
        kind: "text",
        text: "write here",
        x: 0.5,
        y: 0.5,
        width: 0.44,
        fontSize: 0.055,
        color: TEXT_COLOR,
        font: DEFAULT_CANVAS_TEXT_FONT,
        angle: 0,
        zIndex: nextCanvasZIndex(documentRef.current.objects),
      }
      const textbox = makeTextObject(object, canvas) as Textbox
      canvas.add(textbox)
      canvas.setActiveObject(textbox)
      reportSelection(object.id)
      textbox.enterEditing()
      textbox.selectAll()
      emitDocument(canvas)
      canvas.requestRenderAll()
    },
    setSelectedTextColor(color: string) {
      if (callbacksRef.current.readOnly || !/^#[0-9a-fA-F]{6}$/.test(color)) return
      const canvas = fabricCanvasRef.current
      const selected = canvas?.getActiveObject() as RuntimeObject | undefined
      if (!canvas || selected?.memento?.kind !== "text") return
      selected.set({ fill: color })
      selected.memento = { ...selected.memento, color }
      selected.setCoords()
      emitDocument(canvas)
      reportSelection(selected.memento.id, selected)
      canvas.requestRenderAll()
    },
    setSelectedTextFont(font: CanvasTextFont) {
      if (callbacksRef.current.readOnly) return
      const canvas = fabricCanvasRef.current
      const selected = canvas?.getActiveObject() as RuntimeObject | undefined
      if (!canvas || selected?.memento?.kind !== "text") return
      const textbox = selected as Textbox
      textbox.set({ fontFamily: canvasTextFontFamily(font) })
      selected.memento = { ...selected.memento, font }
      fitTextWidth(textbox, canvas)
      textbox.initDimensions()
      selected.setCoords()
      emitDocument(canvas)
      reportSelection(selected.memento.id, selected)
      canvas.requestRenderAll()
      const fontDescriptor = canvasTextFontLoadDescriptor(font)
      if (fontDescriptor && typeof window !== "undefined") {
        const selectedPageId = pageIdRef.current
        const selectedSession = pageSessionRef.current
        void window.document.fonts?.load(fontDescriptor).then(() => {
          if (fabricCanvasRef.current !== canvas || pageIdRef.current !== selectedPageId || pageSessionRef.current !== selectedSession) return
          fitTextWidth(textbox, canvas)
          textbox.initDimensions()
          selected.setCoords()
          emitDocument(canvas)
          canvas.requestRenderAll()
        }).catch(() => undefined)
      }
    },
    deleteSelected() {
      if (callbacksRef.current.readOnly) return
      const canvas = fabricCanvasRef.current
      const selected = canvas?.getActiveObject()
      if (!canvas || !selected) return
      canvas.remove(selected)
      canvas.discardActiveObject()
      reportSelection(null)
      emitDocument(canvas)
      canvas.requestRenderAll()
    },
    bringSelectedForward() {
      if (callbacksRef.current.readOnly) return
      const canvas = fabricCanvasRef.current
      const selected = canvas?.getActiveObject()
      if (!canvas || !selected) return
      canvas.bringObjectForward(selected)
      emitDocument(canvas)
      canvas.requestRenderAll()
    },
    sendSelectedBackward() {
      if (callbacksRef.current.readOnly) return
      const canvas = fabricCanvasRef.current
      const selected = canvas?.getActiveObject()
      if (!canvas || !selected) return
      canvas.sendObjectBackwards(selected)
      emitDocument(canvas)
      canvas.requestRenderAll()
    },
  }), [emitDocument, fitTextWidth, makeMissingObject, makeStickerObject, makeTapeObject, makeTextObject, reportSelection])

  return (
    <div
      id="fabricJournalCanvas"
      ref={hostRef}
      className="fabric-journal-canvas"
      aria-busy={loading}
      data-canvas-load-error={loadIssues.length ? "true" : "false"}
      data-object-count={document.objects.length}
      data-tape-count={document.objects.filter((object) => object.kind === "tape").length}
      data-text-fonts={document.objects.filter((object) => object.kind === "text").map((object) => object.font ?? DEFAULT_CANVAS_TEXT_FONT).join(",")}
    >
      <canvas ref={canvasElementRef} aria-label="Journal canvas" />
      {loadIssues.length ? (
        <div
          role="alert"
          style={{ position: "absolute", inset: "auto 12px 12px", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "7px 10px", border: "1px solid rgba(154, 101, 71, .32)", borderRadius: 12, background: "rgba(255, 253, 247, .92)", color: "#4b392f", fontSize: 11, boxShadow: "0 5px 16px rgba(61, 48, 40, .12)" }}
        >
          <span>部分图片加载失败，页面内容已保留。</span>
          <button type="button" onClick={() => { renderedDocumentKeyRef.current = null; renderedSourceKeyRef.current = null; setRetryToken((value) => value + 1) }}>重试</button>
        </div>
      ) : null}
    </div>
  )
})
