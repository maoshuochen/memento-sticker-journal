import { Check, LoaderCircle, RotateCcw, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { StickerFinish } from "@/domain/model"
import { cropSelectionForCutout, clampCropSelection, type CropSelection } from "@/lib/recutout"
import { optimizeStickerStorage } from "@/lib/images"

type DragMode = "move" | "resize" | "rotate"
type DragState = { mode: DragMode; clientX: number; clientY: number; selection: CropSelection }

const initialSelection: CropSelection = { x: 0.5, y: 0.5, width: 0.78, height: 0.78, angle: 0 }

function requestCutout(source: Blob): Promise<Blob> {
  const form = new FormData()
  form.set("image", source, "memento-selected-subject.jpg")
  return fetch("/api/cutout", { method: "POST", credentials: "same-origin", body: form }).then(async (response) => {
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(payload.error ?? "云端抠图失败，请稍后再试。")
    }
    const result = await response.blob()
    if (!result.size || result.type !== "image/png") throw new Error("云端返回了无效的抠图结果。")
    return await optimizeStickerStorage(result)
  })
}

export function ReCutoutSheet({
  open,
  source,
  finish,
  edgeThickness,
  onClose,
  onConfirm,
}: {
  open: boolean
  source: Blob | null
  finish: StickerFinish
  edgeThickness: number
  onClose(): void
  onConfirm(render: Blob): Promise<void>
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [selection, setSelection] = useState<CropSelection>(initialSelection)
  const [result, setResult] = useState<Blob | null>(null)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [imageAspect, setImageAspect] = useState<number | null>(null)
  const sourceUrl = useMemo(() => source ? URL.createObjectURL(source) : "", [source])
  const resultUrl = useMemo(() => result ? URL.createObjectURL(result) : "", [result])

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl) }, [sourceUrl])
  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl) }, [resultUrl])
  useEffect(() => { if (open) { setSelection(initialSelection); setResult(null); setProcessing(false); setImageAspect(null) } }, [open, source])

  function frameMetrics(): DOMRect | null { return frameRef.current?.getBoundingClientRect() ?? null }
  function updateFromPointer(event: React.PointerEvent<HTMLElement>): void {
    const drag = dragRef.current
    const frame = frameMetrics()
    if (!drag || !frame) return
    const pointerX = (event.clientX - frame.left) / frame.width
    const pointerY = (event.clientY - frame.top) / frame.height
    if (drag.mode === "move") {
      setSelection(clampCropSelection({ ...drag.selection, x: drag.selection.x + (event.clientX - drag.clientX) / frame.width, y: drag.selection.y + (event.clientY - drag.clientY) / frame.height }))
      return
    }
    if (drag.mode === "rotate") {
      const angle = Math.atan2(pointerY - drag.selection.y, pointerX - drag.selection.x) * 180 / Math.PI + 90
      setSelection(clampCropSelection({ ...drag.selection, angle }))
      return
    }
    const radians = -drag.selection.angle * Math.PI / 180
    const dx = pointerX - drag.selection.x
    const dy = pointerY - drag.selection.y
    const localX = Math.abs(dx * Math.cos(radians) - dy * Math.sin(radians)) * 2
    const localY = Math.abs(dx * Math.sin(radians) + dy * Math.cos(radians)) * 2
    // The crop is intentionally freeform: a tall bottle, a horizontal label,
    // and a square face should not all be forced into the same ratio.
    setSelection(clampCropSelection({
      ...drag.selection,
      width: Math.max(0.12, localX),
      height: Math.max(0.12, localY),
    }))
  }
  function beginDrag(mode: DragMode, event: React.PointerEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { mode, clientX: event.clientX, clientY: event.clientY, selection }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function endDrag(event: React.PointerEvent<HTMLElement>): void {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  async function createPreview(): Promise<void> {
    if (!source) return
    setProcessing(true)
    try {
      setResult(await requestCutout(await cropSelectionForCutout(source, selection)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重新抠图失败，请稍后再试。")
    } finally { setProcessing(false) }
  }
  async function confirm(): Promise<void> {
    if (!result) return
    setSaving(true)
    try { await onConfirm(result) } finally { setSaving(false) }
  }
  const selectionStyle = {
    left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%`, transform: `translate(-50%, -50%) rotate(${selection.angle}deg)`,
  } as CSSProperties
  return <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    <SheetContent side="bottom" className="memento-sheet recutout-sheet" onOpenAutoFocus={(event) => event.preventDefault()}>
      <SheetHeader><SheetTitle>{result ? "预览新的贴纸" : "重新圈选主体"}</SheetTitle></SheetHeader>
      {result ? <div className="recutout-result"><span className={`memento-sticker cutout ${finish}`} style={{ "--edge": `${edgeThickness}px` } as React.CSSProperties}><img src={resultUrl} alt="新的抠图预览" /></span></div> : <div ref={frameRef} className="recutout-frame" style={imageAspect ? { aspectRatio: String(imageAspect) } : undefined} onPointerMove={updateFromPointer} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {sourceUrl ? <img src={sourceUrl} alt="可编辑原图" draggable={false} onLoad={(event) => setImageAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} /> : null}
        <div className="recutout-selection" style={selectionStyle} onPointerDown={(event) => beginDrag("move", event)}>
          <span className="recutout-resize" aria-label="Resize selection" onPointerDown={(event) => beginDrag("resize", event)} />
          <span className="recutout-rotate" aria-label="Rotate selection" onPointerDown={(event) => beginDrag("rotate", event)} />
        </div>
      </div>}
      <p className="recutout-hint">{result ? "确认后会替换当前贴纸，名称、分组与手帐位置不会改变。" : "拖动选框移动主体；右下角可自由调整宽高；上方圆点可旋转。"}</p>
      <div className="recutout-actions">{result ? <><Button variant="outline" onClick={() => setResult(null)}><RotateCcw /> 重新选择</Button><Button disabled={saving} onClick={() => void confirm()}>{saving ? <LoaderCircle className="animate-spin" /> : <Check />} 替换此贴纸</Button></> : <><Button variant="outline" onClick={onClose}><X /> 取消</Button><Button disabled={processing || !source} onClick={() => void createPreview()}>{processing ? <LoaderCircle className="animate-spin" /> : null} 重新抠图</Button></>}</div>
    </SheetContent>
  </Sheet>
}
