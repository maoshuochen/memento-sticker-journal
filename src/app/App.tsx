import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router"

import { MementoLayout } from "@/app/MementoLayout"
import { LibraryPage } from "@/pages/LibraryPage"

const JournalsPage = lazy(() => import("@/pages/JournalsPage").then((module) => ({ default: module.JournalsPage })))
const JournalEditorPage = lazy(() => import("@/pages/JournalEditorPage").then((module) => ({ default: module.JournalEditorPage })))

function RouteFallback() {
  return <div className="route-loading" role="status">opening your journal…</div>
}

export function App() {
  return (
    <Routes>
      <Route element={<MementoLayout />}>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/journals" element={<Suspense fallback={<RouteFallback />}><JournalsPage /></Suspense>} />
        <Route path="/journals/:journalId" element={<Suspense fallback={<RouteFallback />}><JournalEditorPage /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
