import { BookOpen, Library, Plus } from "lucide-react"
import { Outlet, useLocation, useNavigate } from "react-router"
import { useState } from "react"

import { useAppData } from "@/app/AppDataProvider"
import { AddStickerFlow } from "@/components/memento/AddStickerFlow"
import { HelpSheet } from "@/components/memento/HelpSheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function MementoLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { snapshot, repository } = useAppData()
  const [addOpen, setAddOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const inJournal = location.pathname.startsWith("/journals")
  const inEditor = /^\/journals\/[^/]+/.test(location.pathname)

  return (
    <main className="app-shell" aria-label="Memento sticker journal">
      {!snapshot.settings.crossOriginMigrationDismissed && !inEditor ? (
        <aside className="migration-banner">
          <span>从 Vercel 旧站迁移数据？</span>
          <Button variant="link" onClick={() => setHelpOpen(true)}>导入 v1 备份</Button>
          <button type="button" aria-label="Dismiss migration reminder" onClick={() => void repository.dismissCrossOriginMigration()}>×</button>
        </aside>
      ) : null}

      <Outlet context={{ openHelp: () => setHelpOpen(true) }} />

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
      <HelpSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </main>
  )
}

export interface MementoOutletContext {
  openHelp(): void
}
