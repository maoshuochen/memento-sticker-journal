import { Camera, ImagePlus, LoaderCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { useAppData } from "@/app/AppDataProvider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { StickerFinish } from "@/domain/model"
import { compressImageForUpload } from "@/lib/images"
import { PeelPreview } from "@/components/memento/PeelPreview"

type CutoutDraft = { blob: Blob; url: string }

export function AddStickerFlow({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { repository } = useAppData()
  const galleryInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false)
  const [draft, setDraft] = useState<CutoutDraft | null>(null)
  const [name, setName] = useState("New sticker")
  const [group, setGroup] = useState("everyday")
  const [finish] = useState<StickerFinish>("edge-soft")
  const [edgeThickness, setEdgeThickness] = useState(3)

  useEffect(() => () => {
    if (draft) URL.revokeObjectURL(draft.url)
  }, [draft])

  async function processFile(file: File): Promise<void> {
    onOpenChange(false)
    setProcessing(true)
    try {
      const compressed = await compressImageForUpload(file)
      const form = new FormData()
      form.set("image", compressed, "memento-upload.jpg")
      const response = await fetch("/api/cutout", { method: "POST", body: form })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error ?? "云端抠图失败，请稍后再试。")
      }
      const blob = await response.blob()
      if (blob.size === 0 || blob.type !== "image/png") throw new Error("云端返回了无效的抠图结果。")
      setDraft((current) => {
        if (current) URL.revokeObjectURL(current.url)
        return { blob, url: URL.createObjectURL(blob) }
      })
      setName(file.name.replace(/\.[^.]+$/, "").slice(0, 36) || "New sticker")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "云端抠图失败，请稍后再试。")
    } finally {
      setProcessing(false)
    }
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) void processFile(file)
  }

  async function saveSticker(): Promise<void> {
    if (!draft) return
    const timestamp = Date.now()
    const stickerId = crypto.randomUUID()
    const assetId = `asset-${stickerId}`
    await repository.putAsset({
      id: assetId,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      mimeType: "image/png",
      blob: draft.blob,
    })
    await repository.putSticker({
      id: stickerId,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      name: name.trim() || "New sticker",
      group: group.trim() || "everyday",
      assetId,
      finish,
      edgeThickness,
      border: "sticker-clean",
      tilt: Math.round(Math.random() * 10 - 5),
    })
    URL.revokeObjectURL(draft.url)
    setDraft(null)
    toast.success("贴纸已保存到你的贴纸库。")
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="memento-sheet">
          <SheetHeader>
            <SheetTitle>Make a sticker</SheetTitle>
            <SheetDescription>拍下眼前的小东西，或从相册选择一张照片。</SheetDescription>
          </SheetHeader>
          <div className="capture-options">
            <Button variant="outline" onClick={() => cameraInput.current?.click()}>
              <Camera /> 拍一张照片
            </Button>
            <Button variant="outline" onClick={() => galleryInput.current?.click()}>
              <ImagePlus /> 从相册选择
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <input ref={galleryInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Photo file upload" onChange={onFileChange} />
      <input ref={cameraInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Camera photo upload" onChange={onFileChange} />

      <Dialog open={processing}>
        <DialogContent className="processing-dialog" showCloseButton={false} aria-describedby="processing-detail">
          <LoaderCircle className="processing-spinner" aria-hidden="true" />
          <DialogHeader>
            <DialogTitle>Removing the background…</DialogTitle>
            <DialogDescription id="processing-detail">正在寻找照片主体，请稍候。</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(draft)} onOpenChange={(next) => {
        if (!next && draft) {
          URL.revokeObjectURL(draft.url)
          setDraft(null)
        }
      }}>
        <DialogContent className="finish-dialog">
          <DialogHeader>
            <DialogTitle>Finish your sticker</DialogTitle>
            <DialogDescription>抓住边缘试着揭起，再给它一个名字。</DialogDescription>
          </DialogHeader>
          {draft ? <PeelPreview source={draft.url} finish={finish} edgeThickness={edgeThickness} /> : null}
          <div className="form-stack">
            <Label htmlFor="sticker-name">Name</Label>
            <Input id="sticker-name" value={name} maxLength={36} onChange={(event) => setName(event.target.value)} />
            <Label htmlFor="sticker-group">Group</Label>
            <Input id="sticker-group" value={group} maxLength={48} onChange={(event) => setGroup(event.target.value)} />
            <Label htmlFor="sticker-edge">White outline · {edgeThickness} px</Label>
            <input id="sticker-edge" type="range" min="1" max="10" value={edgeThickness} onChange={(event) => setEdgeThickness(event.target.valueAsNumber)} />
          </div>
          <Button className="wide-action" onClick={() => void saveSticker()}>Save sticker <span>→</span></Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
