import { ArrowDown, ArrowLeft, ArrowUp, Download, Minus, Plus, Redo2, RotateCw, Trash2, Undo2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Navigate, useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { useAppData } from "@/app/AppDataProvider"
import { StickerImage } from "@/components/memento/StickerImage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { appendHistory, moveHistory } from "@/domain/editor"
import type { JournalPageRecord, Placement } from "@/domain/model"
import { downloadBlob } from "@/lib/images"
import { cn } from "@/lib/utils"

function stickerIdFromPlacement(id: string): string {
  return id.split("::", 1)[0] ?? id
}

export function JournalEditorPage() {
  const { journalId } = useParams()
  const navigate = useNavigate()
  const { snapshot, repository } = useAppData()
  const journal = snapshot.journals.find((item) => item.id === journalId)
  const [pageNumber, setPageNumber] = useState(journal?.currentPage ?? 1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [wordsOpen, setWordsOpen] = useState(false)
  const [headline, setHeadline] = useState("")
  const [note, setNote] = useState("")
  const canvasRef = useRef<HTMLElement>(null)

  const page = snapshot.journalPages.find((item) => item.journalId === journalId && item.pageNumber === pageNumber)
  const stickerById = useMemo(() => new Map(snapshot.stickers.map((sticker) => [sticker.id, sticker])), [snapshot.stickers])

  useEffect(() => {
    if (!journal || page) return
    const timestamp = Date.now()
    void repository.putJournalPage({
      id: `${journal.id}:${pageNumber}`,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      journalId: journal.id,
      pageNumber,
      words: { headline: "", note: "" },
      placements: [],
      history: { entries: [[]], index: 0 },
    })
  }, [journal, page, pageNumber, repository])

  if (!journalId || !journal) return <Navigate to="/journals" replace />
  const activeJournal = journal

  async function persistPage(next: JournalPageRecord): Promise<void> {
    await repository.putJournalPage({ ...next, revision: next.revision + 1, updatedAt: Date.now() })
  }

  async function commitPlacements(placements: Placement[]): Promise<void> {
    if (!page) return
    await persistPage({ ...page, placements, history: appendHistory(page.history, placements) })
  }

  async function addSticker(stickerId: string): Promise<void> {
    if (!page) return
    const locations = [[204, 125, 8], [38, 247, -8], [189, 253, 4]] as const
    const [left, top, angle] = locations[page.placements.length % locations.length] ?? locations[0]
    const placement: Placement = {
      id: `${stickerId}::${crypto.randomUUID()}`,
      left,
      top,
      angle,
      scale: 1,
      zIndex: Math.max(0, ...page.placements.map((item) => item.zIndex)) + 1,
    }
    await commitPlacements([...page.placements, placement])
    setSelectedId(placement.id)
  }

  async function updateSelected(update: Partial<Placement>): Promise<void> {
    if (!page || !selectedId) return
    await commitPlacements(page.placements.map((item) => item.id === selectedId ? { ...item, ...update } : item))
  }

  async function undoRedo(direction: -1 | 1): Promise<void> {
    if (!page) return
    const result = moveHistory(page.history, direction)
    if (!result) return
    await persistPage({ ...page, ...result })
    setSelectedId(null)
  }

  async function changePage(next: number): Promise<void> {
    if (next < 1 || next > activeJournal.pages) return
    setSelectedId(null)
    setPageNumber(next)
    await repository.putJournal({ ...activeJournal, currentPage: next, revision: activeJournal.revision + 1, updatedAt: Date.now() })
  }

  async function addPage(): Promise<void> {
    const next = activeJournal.pages + 1
    const timestamp = Date.now()
    await repository.putJournal({ ...activeJournal, pages: next, currentPage: next, revision: activeJournal.revision + 1, updatedAt: timestamp })
    await repository.putJournalPage({
      id: `${activeJournal.id}:${next}`,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      journalId: activeJournal.id,
      pageNumber: next,
      words: { headline: "", note: "" },
      placements: [],
      history: { entries: [[]], index: 0 },
    })
    setPageNumber(next)
  }

  function openWords(): void {
    setHeadline(page?.words.headline ?? "")
    setNote(page?.words.note ?? "")
    setWordsOpen(true)
  }

  async function saveWords(): Promise<void> {
    if (!page) return
    await persistPage({ ...page, words: { headline, note } })
    setWordsOpen(false)
  }

  async function exportPage(): Promise<void> {
    if (!canvasRef.current) return
    const { default: html2canvas } = await import("html2canvas")
    const canvas = await html2canvas(canvasRef.current, { backgroundColor: "#faf7ed", scale: 2, useCORS: true })
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("导出失败。")), "image/png"))
    downloadBlob(blob, `${activeJournal.title.replace(/\s+/g, "-").toLowerCase()}-page-${pageNumber}.png`)
    toast.success("手帐页已导出。")
  }

  function beginDrag(event: React.PointerEvent<HTMLElement>, placement: Placement): void {
    if (!canvasRef.current) return
    event.preventDefault()
    setSelectedId(placement.id)
    const target = event.currentTarget
    const startX = event.clientX
    const startY = event.clientY
    const pointerId = event.pointerId
    target.setPointerCapture(pointerId)
    const move = (moveEvent: PointerEvent) => {
      target.style.left = `${placement.left + moveEvent.clientX - startX}px`
      target.style.top = `${placement.top + moveEvent.clientY - startY}px`
    }
    const end = (endEvent: PointerEvent) => {
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerup", end)
      target.removeEventListener("pointercancel", end)
      const canvas = canvasRef.current
      if (!canvas || !page) return
      const maxLeft = Math.max(0, canvas.clientWidth - target.offsetWidth)
      const maxTop = Math.max(0, canvas.clientHeight - target.offsetHeight)
      const left = Math.min(maxLeft, Math.max(0, placement.left + endEvent.clientX - startX))
      const top = Math.min(maxTop, Math.max(0, placement.top + endEvent.clientY - startY))
      void commitPlacements(page.placements.map((item) => item.id === placement.id ? { ...item, left, top } : item))
    }
    target.addEventListener("pointermove", move)
    target.addEventListener("pointerup", end)
    target.addEventListener("pointercancel", end)
  }

  const historyIndex = page?.history.index ?? 0
  const visibleDots = Array.from({ length: activeJournal.pages }, (_, index) => index + 1).slice(Math.max(0, pageNumber - 3), Math.max(5, pageNumber + 2))

  return (
    <section className="journal-editor" aria-labelledby="journal-title">
      <header className="topbar detail-topbar">
        <button className="round-icon" aria-label="Back to my journals" onClick={() => void navigate("/journals")}><ArrowLeft /></button>
        <p className="wordmark">memento</p>
        <button className="round-icon" aria-label="Export this page" onClick={() => void exportPage()}><Download /></button>
      </header>
      <div className="journal-intro">
        <p className="eyebrow journal-meta"><span>{activeJournal.year}</span><span id="saveStatus">saved on this device</span></p>
        <h1 id="journal-title">{activeJournal.title}</h1>
        <p>page {pageNumber} of {activeJournal.pages}</p>
      </div>

      <section ref={canvasRef} className={cn("journal-canvas", activeJournal.paper)} aria-label="Journal canvas" onPointerDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null) }}>
        <div className="paper-label"><span>MEM</span><span>{String(pageNumber).padStart(2, "0")}</span><span>{new Date().getFullYear()}</span></div>
        <p className="canvas-line canvas-line-one">{page?.words.headline}</p>
        <p className="canvas-line canvas-line-two">{page?.words.note}</p>
        <div id="canvasStickers" className="canvas-stickers">
          {page?.placements.map((placement) => {
            const sticker = stickerById.get(stickerIdFromPlacement(placement.id))
            if (!sticker) return null
            const selected = selectedId === placement.id
            return (
              <div
                key={placement.id}
                className={cn("canvas-sticker", selected && "is-selected")}
                style={{ left: placement.left, top: placement.top, zIndex: placement.zIndex, transform: `rotate(${placement.angle}deg) scale(${placement.scale})` }}
                role="button"
                tabIndex={0}
                aria-label={`Move ${sticker.name}`}
                onPointerDown={(event) => beginDrag(event, placement)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(placement.id) }}
              >
                <StickerImage sticker={sticker} />
                {selected ? (
                  <span className="sticker-toolbar" onPointerDown={(event) => event.stopPropagation()}>
                    <button aria-label="Delete sticker" onClick={() => void commitPlacements(page.placements.filter((item) => item.id !== placement.id))}><Trash2 /></button>
                    <button aria-label="Rotate sticker" onClick={() => void updateSelected({ angle: placement.angle + 15 })}><RotateCw /></button>
                    <button aria-label="Resize sticker" onClick={() => void updateSelected({ scale: Math.min(2.2, placement.scale + 0.15) })}><Plus /></button>
                    <button aria-label="Make sticker smaller" onClick={() => void updateSelected({ scale: Math.max(0.35, placement.scale - 0.15) })}><Minus /></button>
                    <button aria-label="Send sticker backward" onClick={() => void updateSelected({ zIndex: Math.max(0, placement.zIndex - 1) })}><ArrowDown /></button>
                    <button aria-label="Bring sticker forward" onClick={() => void updateSelected({ zIndex: Math.max(...page.placements.map((item) => item.zIndex)) + 1 })}><ArrowUp /></button>
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
        <p className={cn("canvas-hint", selectedId && "is-hidden")}>tap a sticker to move, turn or resize it</p>
        <span className="masking-tape tape-one" aria-hidden="true" />
        <span className="masking-tape tape-two" aria-hidden="true" />
      </section>

      <div className="page-controls">
        <button aria-label="Undo" disabled={historyIndex <= 0} onClick={() => void undoRedo(-1)}><Undo2 /></button>
        <button aria-label="Redo" disabled={!page || historyIndex >= page.history.entries.length - 1} onClick={() => void undoRedo(1)}><Redo2 /></button>
        <button aria-label="Previous page" disabled={pageNumber === 1} onClick={() => void changePage(pageNumber - 1)}>←</button>
        <div className="page-dots" aria-label="Journal pages">
          {visibleDots.map((number) => <button key={number} className={number === pageNumber ? "is-current" : ""} aria-label={`Open page ${number}`} onClick={() => void changePage(number)} />)}
        </div>
        <button aria-label="Next page" disabled={pageNumber === activeJournal.pages} onClick={() => void changePage(pageNumber + 1)}>→</button>
        <button className="new-page-button" onClick={() => void addPage()}>+ page</button>
      </div>

      <section className="canvas-sticker-dock" aria-label="Stickers for this page">
        <div className="dock-label"><span>stickers</span><button onClick={openWords}>edit words</button></div>
        <div className="canvas-sticker-scroll">
          {snapshot.stickers.map((sticker) => (
            <button key={sticker.id} className="dock-sticker" aria-label={`Add ${sticker.name} to this page`} onClick={() => void addSticker(sticker.id)}><StickerImage sticker={sticker} /></button>
          ))}
        </div>
      </section>

      <Sheet open={wordsOpen} onOpenChange={setWordsOpen}>
        <SheetContent side="bottom" className="memento-sheet">
          <SheetHeader>
            <SheetDescription>Give the page a voice</SheetDescription>
            <SheetTitle>Edit page words</SheetTitle>
          </SheetHeader>
          <div className="form-stack">
            <Label htmlFor="page-headline">Main line</Label>
            <Input id="page-headline" value={headline} maxLength={80} placeholder="soft morning, still warm." onChange={(event) => setHeadline(event.target.value)} />
            <Label htmlFor="page-note">Little note</Label>
            <Input id="page-note" value={note} maxLength={90} placeholder="save what made you smile" onChange={(event) => setNote(event.target.value)} />
          </div>
          <div className="word-actions">
            <Button variant="outline" onClick={() => { setHeadline(""); setNote("") }}>clear words</Button>
            <Button onClick={() => void saveWords()}>Keep these words <span>→</span></Button>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  )
}
