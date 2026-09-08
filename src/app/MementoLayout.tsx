import { BookOpen, Library, Plus } from "lucide-react"
import { Outlet, useLocation, useNavigate } from "react-router"
import { useRef, useState } from "react"

import { AddStickerFlow } from "@/components/memento/AddStickerFlow"
import { HelpSheet } from "@/components/memento/HelpSheet"
import { StickerOutlineFilters } from "@/components/memento/StickerOutlineFilters"
import { cn } from "@/lib/utils"

export function MementoLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [addOpen, setAddOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountTriggerRef = useRef<HTMLElement | null>(null)
  const inJournal = location.pathname.startsWith("/journals")
  const inEditor = /^\/journals\/[^/]+/.test(location.pathname)

  return (
    <main className="app-shell" aria-label="Memento sticker journal">
      <StickerOutlineFilters />
      <Outlet context={{ openAccount: () => { accountTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setAccountOpen(true) } }} />

      {!inEditor ? (
        <nav className="bottom-nav" aria-label="Main navigation">
          <button className={cn("nav-item", !inJournal && "is-active")} onClick={() => void navigate("/")}>
            <Library aria-hidden="true" /><span>library</span>
          </button>
          <button className="add-button" aria-label="Add a photo" onClick={() => setAddOpen(true)}><Plus /></button>
          <button className={cn("nav-item", inJournal && "is-active")} onClick={() => void navigate("/journals")}>
            <BookOpen aria-hidden="true" /><span>journal</span>
          </button>
        </nav>
      ) : null}

      <AddStickerFlow open={addOpen} onOpenChange={setAddOpen} />
      <HelpSheet open={accountOpen} onOpenChange={setAccountOpen} onReturnFocus={() => accountTriggerRef.current?.focus()} />
    </main>
  )
}

export interface MementoOutletContext {
  openAccount(): void
}
