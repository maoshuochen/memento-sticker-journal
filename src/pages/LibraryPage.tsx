import { HelpCircle, RefreshCw, Search, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import { useNavigate, useOutletContext } from "react-router"
import { toast } from "sonner"

import type { MementoOutletContext } from "@/app/MementoLayout"
import { useAppData } from "@/app/AppDataProvider"
import { PeelPreview } from "@/components/memento/PeelPreview"
import { StickerImage } from "@/components/memento/StickerImage"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { StickerRecord } from "@/domain/model"

declare global {
  interface Window {
    runGravityDrop?: (options?: { replay?: boolean }) => void
  }
}

export function LibraryPage() {
  const { snapshot, assetUrls, repository } = useAppData()
  const { openHelp } = useOutletContext<MementoOutletContext>()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [group, setGroup] = useState("all")
  const [dropKey, setDropKey] = useState(0)
  const [busy, setBusy] = useState(true)
  const [selected, setSelected] = useState<StickerRecord | null>(null)
  const [draftName, setDraftName] = useState("")
  const [draftGroup, setDraftGroup] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)

  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const sticker of snapshot.stickers) counts.set(sticker.group, (counts.get(sticker.group) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [snapshot.stickers])

  const visible = useMemo(() => snapshot.stickers
    .filter((sticker) => group === "all" || sticker.group === group)
    .filter((sticker) => `${sticker.name} ${sticker.group}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.createdAt - a.createdAt), [group, query, snapshot.stickers])

  const replay = useCallback(() => {
    setSelected(null)
    setBusy(true)
    setDropKey((value) => value + 1)
    window.setTimeout(() => setBusy(false), 1650)
  }, [])

  useEffect(() => {
    window.runGravityDrop = replay
    const timeout = window.setTimeout(() => setBusy(false), 1650)
    return () => {
      window.clearTimeout(timeout)
      delete window.runGravityDrop
    }
  }, [replay])

  function openDetails(sticker: StickerRecord): void {
    setBusy(false)
    setSelected(sticker)
    setDraftName(sticker.name)
    setDraftGroup(sticker.group)
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

  return (
    <section className="screen library-screen" aria-labelledby="library-title">
      <header className="topbar">
        <button className="round-icon" aria-label="How Memento works" onClick={openHelp}><HelpCircle /></button>
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
        <p className="eyebrow">Your saved little things</p>
        <h1 id="library-title">Sticker<br />library</h1>
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
          <span><button aria-label="Let stickers fall again" onClick={replay}><RefreshCw /></button> tap to manage</span>
        </div>
        <div id="stickerShelf" key={`${dropKey}-${group}`} className="sticker-shelf" aria-busy={busy ? "true" : undefined}>
          {visible.map((sticker, index) => (
            <button
              key={sticker.id}
              className="gravity-sticker"
              style={{ "--drop-delay": `${Math.min(index, 12) * 55}ms` } as CSSProperties}
              aria-label={`Manage ${sticker.name}`}
              onClick={() => openDetails(sticker)}
            >
              <StickerImage sticker={sticker} />
            </button>
          ))}
        </div>
        {visible.length === 0 ? <div className="sticker-empty"><Search /><strong>No little thing found</strong><small>Try another word or group.</small></div> : null}
        <div className="shelf-shadow" aria-hidden="true" />
      </section>

      <Sheet open={Boolean(selected)} onOpenChange={(next) => { if (!next) setSelected(null) }}>
        <SheetContent side="bottom" className="memento-sheet sticker-detail-sheet" data-sheet-y="0">
          <SheetHeader>
            <SheetDescription>From your library</SheetDescription>
            <SheetTitle>Sticker details</SheetTitle>
          </SheetHeader>
          {selected && assetUrls.get(selected.assetId) ? (
            <PeelPreview source={assetUrls.get(selected.assetId) ?? ""} finish={selected.finish} edgeThickness={selected.edgeThickness} />
          ) : null}
          <div className="form-stack">
            <Label htmlFor="detail-name">Sticker name</Label>
            <Input id="detail-name" value={draftName} maxLength={36} onChange={(event) => setDraftName(event.target.value)} />
            <Label htmlFor="detail-group">Group</Label>
            <Input id="detail-group" value={draftGroup} maxLength={48} onChange={(event) => setDraftGroup(event.target.value)} />
          </div>
          <div className="detail-actions">
            <Button variant="destructive" aria-label="Delete sticker" onClick={() => setDeleteOpen(true)}><Trash2 /> delete</Button>
            <Button variant="outline" onClick={() => void saveDetails()}>save details</Button>
            <Button onClick={() => {
              const journal = snapshot.journals[0]
              setSelected(null)
              void navigate(journal ? `/journals/${journal.id}` : "/journals")
            }}>Place in journal <span>→</span></Button>
          </div>
        </SheetContent>
      </Sheet>

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
