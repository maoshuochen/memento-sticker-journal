import { Camera, Check, CircleAlert, ImagePlus, Images, LoaderCircle, Pause, Play, RotateCcw, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { useAppData } from "@/app/AppDataProvider"
import { PeelPreview } from "@/components/memento/PeelPreview"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { BATCH_MAX_IN_FLIGHT_REQUESTS, BatchRequestStartGate, MAX_BATCH_UPLOAD_FILES, type BatchUploadItemRecord, type BatchUploadSnapshot } from "@/data/batchUploads"
import type { StickerFinish } from "@/domain/model"
import { compressImageForUpload, isSupportedUploadImage, optimizeStickerStorage } from "@/lib/images"

type CutoutDraft = { blob: Blob; sourceBlob: Blob; url: string }
type BatchSelection = { id: string; file: File; url: string }
type CutoutResult = { blob: Blob; sourceBlob: Blob; name: string | null; group: string | null; recognitionStatus: string | null }
type HttpFailure = Error & { status?: number; retryAfterMs?: number }

const MAX_STICKER_STORAGE_BYTES = 50 * 1024 * 1024
const MAX_TRANSIENT_ATTEMPTS = 3

function decodeHeaderValue(value: string | null): string | null {
  if (!value) return null
  try { return decodeURIComponent(value) } catch { return null }
}

function fallbackStickerName(sourceName: string): string {
  const stem = sourceName.replace(/\.[^.]+$/, "").trim().slice(0, 36)
  return !stem || /^\d+$/.test(stem) ? "未命名贴纸" : stem
}

function isUnrecognizedBatchItem(item: Pick<BatchUploadItemRecord, "recognizedName">): boolean {
  return !item.recognizedName || /^\d+$/.test(item.recognizedName.trim())
}

function isTransientFailure(error: HttpFailure): boolean {
  return error.status === undefined || error.status === 408 || error.status === 429 || (error.status !== undefined && error.status >= 500)
}

export function AddStickerFlow({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { repository, snapshot } = useAppData()
  const galleryInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const reselectInput = useRef<HTMLInputElement>(null)
  const runnerRef = useRef<string | null>(null)
  const batchRequestGateRef = useRef(new BatchRequestStartGate())
  const [processing, setProcessing] = useState(false)
  const [draft, setDraft] = useState<CutoutDraft | null>(null)
  const [name, setName] = useState("New sticker")
  const [group, setGroup] = useState("everyday")
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const largestViewportHeight = useRef(0)
  const [finish] = useState<StickerFinish>("edge-soft")
  const [edgeThickness, setEdgeThickness] = useState(3)
  const [batchSelection, setBatchSelection] = useState<BatchSelection[] | null>(null)
  const [batch, setBatch] = useState<BatchUploadSnapshot | null>(null)
  const [batchSheetOpen, setBatchSheetOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [savingBatch, setSavingBatch] = useState(false)
  const [recognizingBatch, setRecognizingBatch] = useState(false)

  const groups = useMemo(() => {
    const names = new Set(snapshot.stickers.map((sticker) => sticker.group).filter(Boolean))
    if (!creatingGroup && group) names.add(group)
    return [...names].sort((left, right) => left.localeCompare(right))
  }, [creatingGroup, group, snapshot.stickers])
  const existingGroupHints = useMemo(() => [...new Set(snapshot.stickers.map((sticker) => sticker.group.trim()).filter(Boolean))].slice(0, 80), [snapshot.stickers])
  const existingAssetBytes = useMemo(() => snapshot.assets.reduce((total, asset) => total + (asset.blob?.size ?? 0), 0), [snapshot.assets])
  const batchReadyItems = batch?.items.filter((item) => item.status === "ready") ?? []
  const selectedBatchItems = batchReadyItems.filter((item) => item.selected)
  const batchBytes = selectedBatchItems.reduce((total, item) => total + (item.cutoutBlob?.size ?? 0) + (item.editableSourceBlob?.size ?? 0), 0)
  const storageWouldOverflow = existingAssetBytes + batchBytes > MAX_STICKER_STORAGE_BYTES

  async function refreshBatch(id?: string): Promise<BatchUploadSnapshot | null> {
    const next = id ? await repository.getBatchUpload(id) : await repository.latestBatchUpload()
    setBatch(next)
    return next
  }

  useEffect(() => {
    let active = true
    void repository.latestBatchUpload().then((next) => {
      if (active) setBatch(next)
    })
    return () => { active = false }
  }, [repository])
  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.url) }, [draft])
  useEffect(() => () => { for (const item of batchSelection ?? []) URL.revokeObjectURL(item.url) }, [batchSelection])

  useEffect(() => {
    if (!draft || typeof window === "undefined") return
    const root = window.document.documentElement
    const updateSheetViewport = () => {
      const viewport = window.visualViewport
      const height = viewport?.height ?? window.innerHeight
      const top = viewport?.offsetTop ?? 0
      const keyboardOffset = Math.max(0, window.innerHeight - height - top)
      largestViewportHeight.current = Math.max(largestViewportHeight.current, height)
      const keyboardThreshold = Math.max(120, largestViewportHeight.current * 0.18)
      root.style.setProperty("--finish-sheet-visible-height", `${Math.round(height)}px`)
      root.style.setProperty("--finish-sheet-keyboard-offset", `${Math.round(keyboardOffset)}px`)
      setKeyboardVisible(largestViewportHeight.current - height > keyboardThreshold)
    }
    updateSheetViewport()
    window.visualViewport?.addEventListener("resize", updateSheetViewport)
    window.visualViewport?.addEventListener("scroll", updateSheetViewport)
    window.addEventListener("resize", updateSheetViewport)
    return () => {
      window.visualViewport?.removeEventListener("resize", updateSheetViewport)
      window.visualViewport?.removeEventListener("scroll", updateSheetViewport)
      window.removeEventListener("resize", updateSheetViewport)
      root.style.removeProperty("--finish-sheet-visible-height")
      root.style.removeProperty("--finish-sheet-keyboard-offset")
      largestViewportHeight.current = 0
      setKeyboardVisible(false)
    }
  }, [draft])

  async function requestCutout(file: Blob, groupHints: string[] = []): Promise<CutoutResult> {
    const compressed = await compressImageForUpload(file)
    const form = new FormData()
    form.set("image", compressed, "memento-upload.jpg")
    if (groupHints.length) form.set("groupHints", JSON.stringify(groupHints))
    const response = await fetch("/api/cutout", { method: "POST", body: form })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      const error = new Error(payload.error ?? "云端抠图失败，请稍后再试。") as HttpFailure
      error.status = response.status
      const retryAfter = Number(response.headers.get("Retry-After"))
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1_000
      throw error
    }
    const rawBlob = await response.blob()
    if (rawBlob.size === 0 || rawBlob.type !== "image/png") throw new Error("云端返回了无效的抠图结果。")
    return {
      blob: await optimizeStickerStorage(rawBlob),
      sourceBlob: compressed,
      name: decodeHeaderValue(response.headers.get("X-Sticker-Name")),
      group: decodeHeaderValue(response.headers.get("X-Sticker-Group")),
      recognitionStatus: response.headers.get("X-Sticker-Recognition-Status"),
    }
  }

  async function requestStickerRecognition(file: Blob, groupHints: string[] = []): Promise<Pick<CutoutResult, "name" | "group" | "recognitionStatus">> {
    const compressed = await compressImageForUpload(file)
    const form = new FormData()
    form.set("image", compressed, "memento-recognition.jpg")
    if (groupHints.length) form.set("groupHints", JSON.stringify(groupHints))
    const response = await fetch("/api/stickers/recognize", { method: "POST", body: form })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(payload.error ?? "AI 识别暂时不可用，请稍后重试。")
    }
    const payload = await response.json() as { name?: unknown; group?: unknown; status?: unknown }
    return {
      name: typeof payload.name === "string" ? payload.name : null,
      group: typeof payload.group === "string" ? payload.group : null,
      recognitionStatus: typeof payload.status === "string" ? payload.status : null,
    }
  }

  async function processFile(file: File): Promise<void> {
    onOpenChange(false)
    setProcessing(true)
    try {
      const result = await requestCutout(file, existingGroupHints)
      setDraft((current) => {
        if (current) URL.revokeObjectURL(current.url)
        return { blob: result.blob, sourceBlob: result.sourceBlob, url: URL.createObjectURL(result.blob) }
      })
      setName(result.name ?? fallbackStickerName(file.name))
      setGroup(result.group ?? "everyday")
      setCreatingGroup(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "云端抠图失败，请稍后再试。")
    } finally {
      setProcessing(false)
    }
  }

  function onGalleryChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const allFiles = [...(event.target.files ?? [])]
    event.target.value = ""
    if (!allFiles.length) return
    if (allFiles.length === 1) {
      const [file] = allFiles
      if (file && isSupportedUploadImage(file)) void processFile(file)
      else toast.error("请选择 JPEG、PNG 或 WebP 图片。")
      return
    }
    if (batch) {
      toast.message("请先完成、审核或丢弃当前批量任务。")
      return
    }
    const unique = new Map<string, File>()
    const invalid = allFiles.filter((file) => !isSupportedUploadImage(file))
    for (const file of allFiles) if (isSupportedUploadImage(file)) unique.set(`${file.name}:${file.size}:${file.lastModified}`, file)
    const files = [...unique.values()].slice(0, MAX_BATCH_UPLOAD_FILES)
    if (invalid.length) toast.message(`已跳过 ${invalid.length} 张不支持的图片。`)
    if (unique.size > MAX_BATCH_UPLOAD_FILES) toast.message(`一次最多处理 ${MAX_BATCH_UPLOAD_FILES} 张，已保留前 ${MAX_BATCH_UPLOAD_FILES} 张。`)
    if (!files.length) return
    setBatchSelection(files.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) })))
    onOpenChange(false)
  }

  function onCameraChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file && isSupportedUploadImage(file)) void processFile(file)
    else if (file) toast.error("请选择 JPEG、PNG 或 WebP 图片。")
  }

  function onReselectChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file && isSupportedUploadImage(file)) void processFile(file)
    else if (file) toast.error("请选择 JPEG、PNG 或 WebP 图片。")
  }

  async function requestGroupSuggestions(job: BatchUploadSnapshot): Promise<void> {
    const ready = job.items.filter((item) => item.status === "ready" && !isUnrecognizedBatchItem(item))
    if (!ready.length) return
    try {
      const response = await fetch("/api/stickers/group-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: ready.map((item) => ({ id: item.id, name: item.recognizedName })), groupHints: job.job.groupHints }),
      })
      if (!response.ok) throw new Error("无法生成分组建议")
      const payload = await response.json() as { suggestions?: Array<{ id?: string; group?: string }>; source?: "bailian" | "fallback" }
      const suggestions = new Map((payload.suggestions ?? []).flatMap((item) => item.id && item.group ? [[item.id, item.group.slice(0, 48)] as const] : []))
      for (const item of ready) await repository.updateBatchItem(item.id, { suggestedGroup: suggestions.get(item.id) ?? item.suggestedGroup ?? "待整理" })
      if (payload.source === "fallback") toast.message("分组建议暂时不可用，已先归入待整理，可在审核页修改。")
    } catch {
      for (const item of ready) if (!item.suggestedGroup) await repository.updateBatchItem(item.id, { suggestedGroup: "待整理" })
    }
  }

  async function waitForBatchWork(jobId: string): Promise<boolean> {
    const current = await repository.getBatchUpload(jobId)
    if (current?.job.status !== "processing") return false
    const queued = current.items.filter((item) => item.status === "queued")
    if (!queued.length) return false
    const nextRetryAt = Math.min(...queued.map((item) => item.retryAt ?? Date.now()))
    const waitMs = Math.max(40, Math.min(30_000, nextRetryAt - Date.now()))
    await new Promise((resolve) => window.setTimeout(resolve, waitMs))
    return true
  }

  async function processBatchWorker(jobId: string): Promise<void> {
    while (runnerRef.current === jobId) {
      const item = await repository.claimNextBatchItem(jobId)
      if (!item) {
        if (!await waitForBatchWork(jobId)) return
        continue
      }
      await refreshBatch(jobId)

      const startAt = batchRequestGateRef.current.reserve()
      const startDelay = Math.max(0, startAt - Date.now())
      if (startDelay) await new Promise((resolve) => window.setTimeout(resolve, startDelay))
      if (runnerRef.current !== jobId) return

      const current = await repository.getBatchUpload(jobId)
      if (current?.job.status !== "processing") return
      try {
        const result = await requestCutout(item.sourceBlob, current.job.groupHints)
        await repository.updateBatchItem(item.id, {
          status: "ready",
          cutoutBlob: result.blob,
          editableSourceBlob: result.sourceBlob,
          recognizedName: result.name ?? undefined,
          suggestedGroup: result.group ?? undefined,
          error: result.name ? undefined : result.recognitionStatus === "not_configured" ? "AI 识别尚未配置。" : "未识别出可靠名称，可在审核页补充。",
        })
      } catch (cause) {
        const error = cause instanceof Error ? cause as HttpFailure : new Error("云端抠图失败，请稍后再试。") as HttpFailure
        if (error.status === 429) {
          await repository.updateBatchItem(item.id, { status: "queued", retryAt: Date.now() + (error.retryAfterMs ?? 60_000), error: "服务繁忙，正在等待后重试。" })
        } else if (isTransientFailure(error) && item.attempts < MAX_TRANSIENT_ATTEMPTS) {
          await repository.updateBatchItem(item.id, { status: "queued", retryAt: Date.now() + 1_500 * 2 ** item.attempts, error: "网络波动，正在重试。" })
        } else {
          await repository.updateBatchItem(item.id, { status: "failed", error: error.message })
        }
      }
      await refreshBatch(jobId)
    }
  }

  async function processBatch(jobId: string): Promise<void> {
    if (runnerRef.current === jobId) return
    runnerRef.current = jobId
    batchRequestGateRef.current = new BatchRequestStartGate()
    setBatchSheetOpen(true)
    try {
      const initial = await repository.getBatchUpload(jobId)
      if (!initial) return
      await repository.updateBatchJob(jobId, { status: "processing" })
      await repository.updateBatchItems(initial.items.filter((item) => item.status === "processing").map((item) => item.id), { status: "queued", retryAt: undefined })
      await Promise.all(Array.from({ length: BATCH_MAX_IN_FLIGHT_REQUESTS }, () => processBatchWorker(jobId)))
      const completed = await repository.getBatchUpload(jobId)
      if (runnerRef.current === jobId && completed?.job.status === "processing" && !completed.items.some((item) => item.status === "queued" || item.status === "processing")) {
        await requestGroupSuggestions(completed)
        await repository.updateBatchJob(jobId, { status: "review" })
        const refreshed = await refreshBatch(jobId)
        if (refreshed?.items.some((item) => item.status === "ready")) setReviewOpen(true)
      }
    } finally {
      if (runnerRef.current === jobId) runnerRef.current = null
      await refreshBatch(jobId)
    }
  }

  async function startBatchSelection(): Promise<void> {
    if (!batchSelection?.length) return
    const created = await repository.createBatchUpload({
      id: crypto.randomUUID(), groupHints: existingGroupHints,
      items: batchSelection.map((item) => ({ id: item.id, sourceBlob: item.file, sourceName: item.file.name })),
    })
    for (const item of batchSelection) URL.revokeObjectURL(item.url)
    setBatchSelection(null)
    setBatch(created)
    void processBatch(created.job.id)
  }

  async function pauseBatch(): Promise<void> {
    if (!batch) return
    await repository.updateBatchJob(batch.job.id, { status: "paused" })
    runnerRef.current = null
    await refreshBatch(batch.job.id)
  }

  async function retryFailedItems(): Promise<void> {
    if (!batch) return
    await repository.updateBatchItems(batch.items.filter((item) => item.status === "failed").map((item) => item.id), { status: "queued", attempts: 0, error: undefined, retryAt: undefined })
    await repository.updateBatchJob(batch.job.id, { status: "queued" })
    void processBatch(batch.job.id)
  }

  async function retryUnrecognizedItems(): Promise<void> {
    if (!batch || recognizingBatch) return
    const items = batch.items.filter((item) => item.status === "ready" && isUnrecognizedBatchItem(item))
    if (!items.length) return
    setRecognizingBatch(true)
    try {
      const gate = new BatchRequestStartGate()
      let recognised = 0
      for (const item of items) {
        const startDelay = Math.max(0, gate.reserve() - Date.now())
        if (startDelay) await new Promise((resolve) => window.setTimeout(resolve, startDelay))
        try {
          const result = await requestStickerRecognition(item.sourceBlob, batch.job.groupHints)
          if (result.name) {
            recognised += 1
            await repository.updateBatchItem(item.id, {
              recognizedName: result.name,
              suggestedGroup: result.group ?? item.suggestedGroup,
              error: undefined,
            })
          }
        } catch {
          // The review warning remains visible and lets the user retry later.
        }
      }
      const refreshed = await refreshBatch(batch.job.id)
      if (refreshed) await requestGroupSuggestions(refreshed)
      await refreshBatch(batch.job.id)
      if (recognised) toast.success(`已识别 ${recognised} 个贴纸名称。`)
      else toast.error("暂未识别出可靠名称，请稍后重试或手动填写。")
    } finally {
      setRecognizingBatch(false)
    }
  }

  async function saveBatch(): Promise<void> {
    if (!batch || !selectedBatchItems.length) return
    if (storageWouldOverflow) { toast.error("所选贴纸会超过 50 MiB 存储上限，请取消部分项目后重试。") ; return }
    setSavingBatch(true)
    try {
      await repository.saveBatchStickers(selectedBatchItems.flatMap((item) => item.cutoutBlob ? [{
        batchItemId: item.id,
        blob: item.cutoutBlob,
        ...(item.editableSourceBlob ? { sourceBlob: item.editableSourceBlob } : {}),
        name: isUnrecognizedBatchItem(item) ? fallbackStickerName(item.sourceName) : item.recognizedName ?? fallbackStickerName(item.sourceName),
        group: item.suggestedGroup ?? "待整理",
        finish,
        edgeThickness,
        border: "sticker-clean" as const,
      }] : []))
      const remaining = await refreshBatch(batch.job.id)
      if (!remaining?.items.length) { await repository.discardBatchUpload(batch.job.id); setBatch(null); setReviewOpen(false) }
      toast.success(`已保存 ${selectedBatchItems.length} 个贴纸。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存贴纸失败，请重试。")
    } finally { setSavingBatch(false) }
  }

  async function saveSticker(): Promise<void> {
    if (!draft) return
    await repository.saveBatchStickers([{ batchItemId: `single-${crypto.randomUUID()}`, blob: draft.blob, sourceBlob: draft.sourceBlob, name: name.trim() || "New sticker", group: group.trim() || "everyday", finish, edgeThickness, border: "sticker-clean" }])
    URL.revokeObjectURL(draft.url)
    setDraft(null)
    toast.success("贴纸已保存到你的贴纸库。")
  }

  const finishedCount = batch?.items.filter((item) => item.status === "ready" || item.status === "failed").length ?? 0
  const failedCount = batch?.items.filter((item) => item.status === "failed").length ?? 0
  const queuedCount = batch?.items.filter((item) => item.status === "queued" || item.status === "processing").length ?? 0
  const unnamedCount = batchReadyItems.filter(isUnrecognizedBatchItem).length
  const batchIsComplete = Boolean(batch && !queuedCount && finishedCount === batch.items.length)
  const batchStatusLabel = batchIsComplete
    ? failedCount ? `已完成 · ${failedCount} 个需重试` : "✅ 已完成"
    : `正在制作贴纸 · ${finishedCount}/${batch?.items.length ?? 0}`
  const groupedItems = (() => {
    const result = new Map<string, BatchUploadItemRecord[]>()
    for (const item of batchReadyItems) {
      const target = item.suggestedGroup?.trim() ?? "待整理"
      result.set(target, [...(result.get(target) ?? []), item])
    }
    return [...result.entries()].sort(([left], [right]) => left.localeCompare(right))
  })()

  return <>
    <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="memento-sheet"><SheetHeader><SheetTitle>Make a sticker</SheetTitle><SheetDescription>拍下一张，或从相册一次选择最多 50 张照片。</SheetDescription></SheetHeader>
      {batch ? <button type="button" className="batch-resume-card" onClick={() => batch.job.status === "review" ? setReviewOpen(true) : setBatchSheetOpen(true)}><Images aria-hidden="true" /><span>批量任务：已完成 {finishedCount} / {batch.items.length}</span><span>{batch.job.status === "review" ? "审核" : "继续"}</span></button> : null}
      <div className="capture-options"><Button variant="outline" onClick={() => cameraInput.current?.click()}><Camera /> 拍一张照片</Button><Button variant="outline" onClick={() => galleryInput.current?.click()}><ImagePlus /> 从相册选择</Button><Button variant="outline" onClick={() => galleryInput.current?.click()}><Images /> 批量从相册添加</Button></div>
    </SheetContent></Sheet>

    <input ref={galleryInput} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Photo file upload" onChange={onGalleryChange} />
    <input ref={cameraInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Camera photo upload" onChange={onCameraChange} />
    <input ref={reselectInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="重新选择图片" onChange={onReselectChange} />
    {batch && !open && batch.job.status !== "review" ? <button type="button" className="batch-progress-trigger" onClick={() => setBatchSheetOpen(true)}>{batchIsComplete ? <Check aria-hidden="true" /> : <LoaderCircle className={batch.job.status === "processing" ? "animate-spin" : ""} aria-hidden="true" />}{batchStatusLabel}</button> : null}

    <Sheet open={Boolean(batchSelection)} onOpenChange={(next) => { if (!next) { for (const item of batchSelection ?? []) URL.revokeObjectURL(item.url); setBatchSelection(null) } }}><SheetContent side="bottom" className="memento-sheet batch-upload-sheet"><SheetHeader><SheetTitle>确认这批照片</SheetTitle><SheetDescription>{batchSelection?.length ?? 0} 张图片将逐张制作贴纸，预计约 {Math.max(1, Math.ceil((batchSelection?.length ?? 0) / 8))} 分钟。处理期间可以关闭面板，稍后手动继续。</SheetDescription></SheetHeader><div className="batch-selection-grid">{batchSelection?.map((item) => <img key={item.id} src={item.url} alt="待处理的照片" />)}</div><Button className="wide-action" onClick={() => void startBatchSelection()}><Play /> 开始制作 {batchSelection?.length ?? 0} 个贴纸</Button></SheetContent></Sheet>

    <Sheet open={batchSheetOpen} onOpenChange={setBatchSheetOpen}><SheetContent side="bottom" className="memento-sheet batch-upload-sheet"><SheetHeader><SheetTitle>批量制作贴纸</SheetTitle><SheetDescription>{batch ? batchStatusLabel : "正在载入任务…"}</SheetDescription></SheetHeader>{batch ? <><div className="batch-progress-bar" aria-label={`上传进度 ${finishedCount}/${batch.items.length}`}><span style={{ width: `${(finishedCount / batch.items.length) * 100}%` }} /></div><div className="batch-progress-summary"><span>{batchIsComplete ? (failedCount ? "处理结束，可重试失败项目" : "✅ 已完成，等待审核") : `剩余 ${queuedCount} 张`}</span></div>{failedCount ? <p className="batch-error"><CircleAlert /> {failedCount} 张暂未完成，可在审核页重试。</p> : null}<div className="batch-sheet-actions">{batch.job.status === "processing" && !batchIsComplete ? <Button variant="outline" onClick={() => void pauseBatch()}><Pause /> 暂停</Button> : null}{batch.job.status === "paused" && queuedCount ? <Button variant="outline" onClick={() => void processBatch(batch.job.id)}><Play /> 继续处理</Button> : null}{batchReadyItems.length ? <Button onClick={() => { setReviewOpen(true); setBatchSheetOpen(false) }}><Check /> 审核已完成项</Button> : null}{failedCount ? <Button variant="outline" onClick={() => void retryFailedItems()}><RotateCcw /> 重试失败项</Button> : null}<Button variant="ghost" onClick={() => { void repository.discardBatchUpload(batch.job.id).then(() => { runnerRef.current = null; setBatch(null); setBatchSheetOpen(false) }) }}><Trash2 /> 丢弃任务</Button></div></> : null}</SheetContent></Sheet>

    <Sheet open={reviewOpen} onOpenChange={setReviewOpen}><SheetContent side="bottom" className="memento-sheet batch-review-sheet"><SheetHeader><SheetTitle>审核贴纸</SheetTitle><SheetDescription>我们按语义聚合了分组建议。可改名、合并到已有组，或保留新的分组。</SheetDescription></SheetHeader><div className="batch-review-summary"><span>已选择 {selectedBatchItems.length} 个</span></div>{unnamedCount ? <div className="batch-review-warning"><p className="batch-error"><CircleAlert /> {unnamedCount} 张未能可靠识别，请补充名称和分组后保存。</p><Button variant="outline" disabled={recognizingBatch} onClick={() => void retryUnrecognizedItems()}>{recognizingBatch ? <LoaderCircle className="animate-spin" /> : <RotateCcw />} 重新识别未命名项</Button></div> : null}{storageWouldOverflow ? <p className="batch-error"><CircleAlert /> 当前选择会超过 50 MiB 存储上限，请取消部分项目。</p> : null}<div className="batch-review-groups">{groupedItems.map(([groupName, items]) => <section key={groupName} className="batch-review-group"><div className="batch-group-heading"><Input aria-label="Edit suggested group" defaultValue={groupName} maxLength={48} onBlur={(event) => { const nextGroup = event.target.value.trim() || "待整理"; if (nextGroup !== groupName) void repository.updateBatchItems(items.map((item) => item.id), { suggestedGroup: nextGroup }).then(() => refreshBatch(batch?.job.id)) }} /><span>{items.length}</span></div><div className="batch-review-items">{items.map((item) => <article key={item.id} className="batch-review-item">{item.cutoutBlob ? <BatchCutoutPreview blob={item.cutoutBlob} /> : null}<input aria-label={`选择 ${isUnrecognizedBatchItem(item) ? fallbackStickerName(item.sourceName) : item.recognizedName}`} type="checkbox" checked={item.selected} onChange={(event) => void repository.updateBatchItem(item.id, { selected: event.target.checked }).then(() => refreshBatch(batch?.job.id))} /><Input aria-label="Sticker name" defaultValue={isUnrecognizedBatchItem(item) ? fallbackStickerName(item.sourceName) : item.recognizedName} maxLength={36} onBlur={(event) => { const nextName = event.target.value.trim() || fallbackStickerName(item.sourceName); if (nextName !== item.recognizedName) void repository.updateBatchItem(item.id, { recognizedName: nextName }).then(() => refreshBatch(batch?.job.id)) }} /><Select value={item.suggestedGroup ?? "待整理"} onValueChange={(value) => void repository.updateBatchItem(item.id, { suggestedGroup: value }).then(() => refreshBatch(batch?.job.id))}><SelectTrigger aria-label="Sticker group"><SelectValue /></SelectTrigger><SelectContent>{[...new Set([...existingGroupHints, ...groupedItems.map(([itemGroup]) => itemGroup), "待整理"])].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></article>)}</div></section>)}</div>{failedCount ? <Button variant="outline" onClick={() => void retryFailedItems()}><RotateCcw /> 重试 {failedCount} 个失败项</Button> : null}<Button className="wide-action" disabled={!selectedBatchItems.length || storageWouldOverflow || savingBatch} onClick={() => void saveBatch()}>{savingBatch ? <LoaderCircle className="animate-spin" /> : <Check />} 保存 {selectedBatchItems.length} 个贴纸</Button></SheetContent></Sheet>

    <Dialog open={processing}><DialogContent className="processing-dialog" showCloseButton={false} aria-describedby="processing-detail"><LoaderCircle className="processing-spinner" aria-hidden="true" /><DialogHeader><DialogTitle>Removing the background…</DialogTitle><DialogDescription id="processing-detail">正在寻找照片主体，请稍候。</DialogDescription></DialogHeader></DialogContent></Dialog>
    <Sheet open={Boolean(draft)} onOpenChange={(next) => { if (!next && draft) { URL.revokeObjectURL(draft.url); setDraft(null) } }}><SheetContent side="bottom" data-sheet-y="0" className={`memento-sheet sticker-finish-sheet${keyboardVisible ? " is-keyboard-active" : ""}`} onOpenAutoFocus={(event) => event.preventDefault()}><SheetHeader><SheetTitle>Finish your sticker</SheetTitle></SheetHeader>{draft ? <PeelPreview source={draft.url} finish={finish} edgeThickness={edgeThickness} /> : null}<div className="form-stack"><Label htmlFor="sticker-name">Name</Label><Input id="sticker-name" value={name} maxLength={36} onChange={(event) => setName(event.target.value)} /><div className="finish-optional-fields"><Label htmlFor="sticker-group">Group</Label><Select value={creatingGroup ? "__new_group__" : group} onValueChange={(value) => { if (value === "__new_group__") { setCreatingGroup(true); setGroup(""); return } setCreatingGroup(false); setGroup(value) }}><SelectTrigger id="sticker-group" className="w-full" aria-label="Choose an existing group or create a new one"><SelectValue placeholder="Choose a group" /></SelectTrigger><SelectContent>{groups.map((groupName) => <SelectItem key={groupName} value={groupName}>{groupName}</SelectItem>)}<SelectItem value="__new_group__">+ New group…</SelectItem></SelectContent></Select></div>{creatingGroup ? <div className="finish-new-group-field"><Label htmlFor="sticker-new-group">New group</Label><Input autoFocus id="sticker-new-group" placeholder="New group name" value={group} maxLength={48} onChange={(event) => setGroup(event.target.value)} /></div> : null}<div className="finish-optional-fields"><Label htmlFor="sticker-edge">White outline · {edgeThickness} px</Label><input id="sticker-edge" type="range" min="1" max="10" value={edgeThickness} onChange={(event) => setEdgeThickness(event.target.valueAsNumber)} /></div></div><div className="finish-sheet-actions"><Button variant="outline" onClick={() => reselectInput.current?.click()}><ImagePlus /> 重新选择</Button><Button className="wide-action" onClick={() => void saveSticker()}>Save sticker <span>→</span></Button></div></SheetContent></Sheet>
  </>
}

function BatchCutoutPreview({ blob }: { blob: Blob }) {
  const [url] = useState(() => URL.createObjectURL(blob))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img src={url} alt="抠图结果" />
}
