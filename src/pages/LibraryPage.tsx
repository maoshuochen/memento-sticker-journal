import { CircleUserRound, Crop, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useOutletContext } from "react-router"
import { toast } from "sonner"

import type { MementoOutletContext } from "@/app/MementoLayout"
import { useAppData } from "@/app/AppDataProvider"
import { PeelPreview } from "@/components/memento/PeelPreview"
import { ReCutoutSheet } from "@/components/memento/ReCutoutSheet"
import { StickerImage } from "@/components/memento/StickerImage"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { StickerRecord } from "@/domain/model"
import { useGravityDrop } from "@/hooks/useGravityDrop"
import { gravityDimensions } from "@/lib/gravity"
import { compressImageForUpload, isSupportedUploadImage, prepareStickerForRecognition } from "@/lib/images"

declare global {
  interface Window {
    runGravityDrop?: (options?: { replay?: boolean }) => void
  }
}

export function LibraryPage() {
  const { snapshot, assetUrls, repository, syncNow } = useAppData()
  const { openAccount } = useOutletContext<MementoOutletContext>()
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [group, setGroup] = useState("all")
  const [selected, setSelected] = useState<StickerRecord | null>(null)
  const [draftName, setDraftName] = useState("")
  const [draftGroup, setDraftGroup] = useState("")
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [recognizingName, setRecognizingName] = useState(false)
  const sourcePickerRef = useRef<HTMLInputElement>(null)
  const [recutOpen, setRecutOpen] = useState(false)
  const [recutSource, setRecutSource] = useState<Blob | null>(null)
  const [recutNeedsSourcePersistence, setRecutNeedsSourcePersistence] = useState(false)
  const [loadingSource, setLoadingSource] = useState(false)

  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const sticker of snapshot.stickers) counts.set(sticker.group, (counts.get(sticker.group) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [snapshot.stickers])

  const visible = useMemo(() => snapshot.stickers
    .filter((sticker) => group === "all" || sticker.group === group)
    .filter((sticker) => `${sticker.name} ${sticker.group}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.createdAt - a.createdAt), [group, query, snapshot.stickers])

  const visibleKey = visible.map((sticker) => sticker.id).join("|")
  const { shelfRef, isDropping: busy, replay: replayGravity, requestMotionPermission } = useGravityDrop(visibleKey)

  const replay = useCallback(() => {
    setSelected(null)
    void requestMotionPermission()
    replayGravity()
  }, [replayGravity, requestMotionPermission])

  useEffect(() => {
    window.runGravityDrop = replay
    return () => {
      delete window.runGravityDrop
    }
  }, [replay])

  function openDetails(sticker: StickerRecord): void {
    setSelected(sticker)
    setDraftName(sticker.name)
    setDraftGroup(sticker.group)
    setCreatingGroup(false)
  }

  async function saveDetails(): Promise<void> {
    if (!selected) return
    await repository.updateSticker(selected.id, {
      name: draftName.trim() || selected.name,
      group: draftGroup.trim() || selected.group,
    })
    setSelected(null)
    toast.success("贴纸信息已更新。")
  }

  async function deleteSticker(): Promise<void> {
    if (!selected) return
    await repository.deleteSticker(selected.id)
    setDeleteOpen(false)
    setSelected(null)
    toast.success("贴纸已移出贴纸库。")
  }

  async function recognizeSelectedSticker(): Promise<void> {
    if (!selected || recognizingName) return
    const source = assetUrls.get(selected.assetId)
    if (!source) {
      toast.error("贴纸图片尚未准备好，请稍后再试。")
      return
    }
    setRecognizingName(true)
    try {
      const sourceImage = await fetch(source).then(async (response) => {
        if (!response.ok) throw new Error("无法读取这张贴纸。")
        return await response.blob()
      })
      const image = await prepareStickerForRecognition(sourceImage)
      const form = new FormData()
      form.set("image", image, "memento-sticker.png")
      const response = await fetch("/api/stickers/recognize", { method: "POST", credentials: "same-origin", body: form })
      const payload = await response.json().catch(() => ({})) as { name?: unknown; error?: string }
      if (!response.ok) throw new Error(payload.error ?? "AI 识别失败，请稍后再试。")
      if (typeof payload.name !== "string" || !payload.name.trim()) {
        toast.message("没有获得可靠的名称，你可以继续手动命名。")
        return
      }
      setDraftName(payload.name)
      toast.success("AI 已重新识别名称，请确认后保存。")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 识别失败，请稍后再试。")
    } finally {
      setRecognizingName(false)
    }
  }

  async function loadSourceAsset(assetId: string): Promise<Blob> {
    const source = snapshot.assets.find((asset) => asset.id === assetId)
    if (!source) throw new Error("找不到这张贴纸的原图。")
    if (source.blob) return source.blob
    const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, { credentials: "same-origin", cache: "no-store" })
    if (!response.ok) throw new Error("无法下载这张贴纸的原图。")
    const blob = await response.blob()
    if (!blob.size || blob.size > 6 * 1024 * 1024 || blob.type !== source.mimeType) throw new Error("原图数据无效，请重试。")
    if (!await repository.cacheAssetBlob(source, blob)) throw new Error("原图已更新，请重新打开。")
    return blob
  }

  async function beginRecut(): Promise<void> {
    if (!selected || loadingSource) return
    if (!selected.sourceAssetId) {
      sourcePickerRef.current?.click()
      return
    }
    setLoadingSource(true)
    try {
      setRecutSource(await loadSourceAsset(selected.sourceAssetId))
      setRecutNeedsSourcePersistence(false)
      setRecutOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法读取原图。")
    } finally { setLoadingSource(false) }
  }

  function onSourceSelected(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (!isSupportedUploadImage(file)) { toast.error("请选择 JPEG、PNG 或 WebP 图片。") ; return }
    setLoadingSource(true)
    void compressImageForUpload(file).then((source) => {
      setRecutSource(source)
      setRecutNeedsSourcePersistence(true)
      setRecutOpen(true)
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "无法处理这张原图。")
    }).finally(() => setLoadingSource(false))
  }

  async function confirmRecut(render: Blob): Promise<void> {
    if (!selected || !recutSource) return
    try {
      await repository.replaceStickerCutout(selected.id, {
        renderBlob: render,
        ...(recutNeedsSourcePersistence ? { sourceBlob: recutSource } : {}),
      })
      await syncNow()
      setRecutOpen(false)
      setSelected(null)
      setRecutSource(null)
      toast.success("已替换贴纸抠图。")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "替换贴纸失败，请稍后重试。")
    }
  }

  return (
    <section className="screen library-screen" aria-labelledby="library-title">
      <header className="topbar">
        <button className="round-icon" aria-label="Open account and settings" onClick={openAccount}><CircleUserRound /></button>
        <p className="wordmark">memento</p>
        <button className="round-icon" aria-label="Search stickers" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search /></button>
      </header>

      {searchOpen ? (
        <div className="search-panel">
          <Search aria-hidden="true" />
          <Input autoFocus type="search" placeholder="find a sticker" aria-label="Search stickers" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      ) : null}

      <div className="library-intro">
        <h1 id="library-title">Sticker library</h1>
        <span className="quiet-label">recent ↓</span>
      </div>

      <div className="group-filters" aria-label="Filter stickers by group">
        <button className={group === "all" ? "is-chosen" : ""} onClick={() => { setGroup("all"); replay() }}>all · {snapshot.stickers.length}</button>
        {groups.map(([name, count]) => (
          <button key={name} className={group === name ? "is-chosen" : ""} aria-label={`${name}, ${count} ${count === 1 ? "sticker" : "stickers"}`} onClick={() => { setGroup(name); replay() }}>{name} · {count}</button>
        ))}
      </div>

      <section className="sticker-stage" aria-label="Saved stickers">
        <div className="stage-caption">
          <span>{visible.length} {visible.length === 1 ? "sticker" : "stickers"}</span>
          <span><button aria-label="Let stickers fall again and enable tilt and shake" title="Enable tilt and shake on supported phones" onClick={replay}><RefreshCw /></button> tap to manage</span>
        </div>
        <div id="stickerShelf" ref={shelfRef} className="sticker-shelf" aria-busy={busy ? "true" : undefined}>
          {visible.map((sticker) => {
            const dimensions = gravityDimensions(sticker.id)
            return (
            <button
              key={sticker.id}
              className="gravity-sticker"
              data-sticker-id={sticker.id}
              data-gravity-width={dimensions.width}
              data-gravity-height={dimensions.height}
              style={{ "--gravity-w": `${dimensions.width}px`, "--gravity-h": `${dimensions.height}px` } as CSSProperties}
              aria-label={`Manage ${sticker.name}`}
              onClick={() => openDetails(sticker)}
            >
              <StickerImage sticker={sticker} />
            </button>
            )
          })}
        </div>
        {visible.length === 0 ? <div className="sticker-empty"><Search /><strong>No little thing found</strong><small>Try another word or group.</small></div> : null}
        <div className="shelf-shadow" aria-hidden="true" />
      </section>

      <input ref={sourcePickerRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择原图用于重新抠图" onChange={onSourceSelected} />
      <Sheet open={Boolean(selected) && !recutOpen} onOpenChange={(next) => { if (!next) { setSelected(null); setCreatingGroup(false) } }}>
        <SheetContent side="bottom" className="memento-sheet sticker-detail-sheet" data-sheet-y="0" onOpenAutoFocus={(event) => event.preventDefault()}>
          <SheetHeader>
            <SheetDescription>From your library</SheetDescription>
            <SheetTitle>Sticker details</SheetTitle>
          </SheetHeader>
          {selected && assetUrls.get(selected.assetId) ? (
            <PeelPreview source={assetUrls.get(selected.assetId) ?? ""} finish={selected.finish} edgeThickness={selected.edgeThickness} />
          ) : null}
          <div className="detail-footer">
            <div className="form-stack">
              <Label htmlFor="detail-name">Sticker name</Label>
              <div className="detail-name-field">
                <Input id="detail-name" value={draftName} maxLength={36} onChange={(event) => setDraftName(event.target.value)} />
                <Button type="button" variant="outline" size="icon" className="recognize-name-button" aria-label="Use AI to recognize sticker name" title="AI 重新识别名称" disabled={recognizingName} onClick={() => void recognizeSelectedSticker()}>
                  <Sparkles className={recognizingName ? "is-spinning" : ""} />
                </Button>
              </div>
              <Label htmlFor="detail-group">Group</Label>
              <Select
                value={creatingGroup ? "__new_group__" : draftGroup}
                onValueChange={(value) => {
                  if (value === "__new_group__") {
                    setCreatingGroup(true)
                    setDraftGroup("")
                    return
                  }
                  setCreatingGroup(false)
                  setDraftGroup(value)
                }}
              >
                <SelectTrigger id="detail-group" className="w-full" aria-label="Choose an existing group or create a new one">
                  <SelectValue placeholder="Choose a group" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map(([name]) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  <SelectItem value="__new_group__">+ New group…</SelectItem>
                </SelectContent>
              </Select>
              {creatingGroup ? (
                <Input autoFocus id="detail-new-group" placeholder="New group name" value={draftGroup} maxLength={48} onChange={(event) => setDraftGroup(event.target.value)} />
              ) : null}
            </div>
            <div className="detail-actions">
              <Button variant="destructive" size="icon" aria-label="删除贴纸" title="删除贴纸" onClick={() => setDeleteOpen(true)}><Trash2 /></Button>
              <Button variant="outline" onClick={() => void saveDetails()}>保存修改</Button>
              <Button variant="outline" className="recutout-entry" disabled={loadingSource} onClick={() => void beginRecut()}><Crop /> {loadingSource ? "正在加载原图…" : selected?.sourceAssetId ? "重新抠图" : "选择原图"}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ReCutoutSheet
        open={recutOpen}
        source={recutSource}
        finish={selected?.finish ?? "edge-soft"}
        edgeThickness={selected?.edgeThickness ?? 3}
        onClose={() => { setRecutOpen(false); setRecutSource(null); setRecutNeedsSourcePersistence(false) }}
        onConfirm={confirmRecut}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this sticker?</AlertDialogTitle>
            <AlertDialogDescription>它会从贴纸库移除，已经贴到手帐页上的内容不受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteSticker()}>Delete sticker</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
