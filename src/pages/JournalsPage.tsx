import { CircleUserRound, Plus } from "lucide-react"
import { useState } from "react"
import { useNavigate, useOutletContext } from "react-router"
import { toast } from "sonner"

import { useAppData } from "@/app/AppDataProvider"
import type { MementoOutletContext } from "@/app/MementoLayout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { JournalCover, JournalPaper } from "@/domain/model"
import { emptyCanvasDocument } from "@/domain/editor"
import { cn } from "@/lib/utils"

const covers: Array<{ id: JournalCover; label: string }> = [
  { id: "cover-blue", label: "Mist blue" },
  { id: "cover-rose", label: "Dusty rose" },
  { id: "cover-sun", label: "Golden" },
  { id: "cover-cocoa", label: "Cocoa" },
]

const papers: Array<{ id: JournalPaper; label: string }> = [
  { id: "paper-grid", label: "dot grid" },
  { id: "paper-plain", label: "warm plain" },
  { id: "paper-lined", label: "soft lines" },
  { id: "paper-calendar", label: "calendar" },
  { id: "paper-ledger", label: "ledger" },
  { id: "paper-sprinkle", label: "sprinkle" },
]

export function JournalsPage() {
  const navigate = useNavigate()
  const { openAccount } = useOutletContext<MementoOutletContext>()
  const { snapshot, repository } = useAppData()
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [cover, setCover] = useState<JournalCover>("cover-blue")
  const [paper, setPaper] = useState<JournalPaper>("paper-grid")

  async function createJournal(): Promise<void> {
    const timestamp = Date.now()
    const id = crypto.randomUUID()
    const resolvedTitle = title.trim() || "Small days"
    await repository.putJournal({
      id,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      title: resolvedTitle,
      year: new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(timestamp),
      pages: 1,
      currentPage: 1,
      cover,
      paper,
    })
    await repository.putJournalPage({
      id: `${id}:1`,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      journalId: id,
      pageNumber: 1,
      canvasDocument: emptyCanvasDocument(),
      history: { entries: [emptyCanvasDocument()], index: 0 },
    })
    setCreateOpen(false)
    toast.success(`${resolvedTitle} is ready.`)
    await navigate(`/journals/${id}`)
  }

  return (
    <section className="screen journal-home-screen" aria-labelledby="journals-title">
      <header className="topbar">
        <button className="round-icon" aria-label="Open account and settings" onClick={openAccount}><CircleUserRound /></button>
        <p className="wordmark">memento</p>
        <button className="round-icon" aria-label="Create a journal" onClick={() => setCreateOpen(true)}><Plus /></button>
      </header>

      <div className="journal-home-intro">
        <p className="eyebrow">A shelf for your pages</p>
        <h1 id="journals-title">My journals</h1>
        <p>Each little book holds a different season.</p>
      </div>

      <section className="journal-books" aria-label="Your journals">
        {snapshot.journals.map((journal) => (
          <button key={journal.id} className={cn("journal-book", journal.cover)} aria-label={`Open ${journal.title}, ${journal.pages} pages`} onClick={() => void navigate(`/journals/${journal.id}`)}>
            <span className="book-year">{journal.year}</span>
            <strong>{journal.title}</strong>
            <small>{journal.pages} pages · page {journal.currentPage}</small>
          </button>
        ))}
      </section>

      <button className="create-book-card" onClick={() => setCreateOpen(true)}>
        <Plus /><span><strong>Start a new book</strong><small>give a season its own pages</small></span>
      </button>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="bottom" className="memento-sheet journal-setup">
          <SheetHeader>
            <SheetDescription>Make room for it</SheetDescription>
            <SheetTitle>Start a new journal</SheetTitle>
          </SheetHeader>
          <div className="form-stack">
            <Label htmlFor="journal-name">Journal name</Label>
            <Input id="journal-name" value={title} maxLength={32} placeholder="Small days" onChange={(event) => setTitle(event.target.value)} />
          </div>
          <p className="eyebrow choice-heading">Choose cover</p>
          <div className="cover-library" aria-label="Choose journal cover">
            {covers.map((item) => <button key={item.id} className={cn("cover-choice", item.id, cover === item.id && "is-chosen")} aria-label={`${item.label} cover`} aria-pressed={cover === item.id} onClick={() => setCover(item.id)} />)}
          </div>
          <p className="eyebrow choice-heading">Choose paper</p>
          <div className="paper-library">
            {papers.map((item) => <button key={item.id} className={cn("paper-card", paper === item.id && "is-chosen")} aria-pressed={paper === item.id} onClick={() => setPaper(item.id)}><span className={cn("paper-swatch", item.id)} /><span>{item.label}</span></button>)}
          </div>
          <Button className="wide-action" onClick={() => void createJournal()}>Create journal <span>→</span></Button>
        </SheetContent>
      </Sheet>
    </section>
  )
}
