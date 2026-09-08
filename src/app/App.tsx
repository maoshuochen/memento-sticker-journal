import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router"

import { MementoLayout } from "@/app/MementoLayout"
import { useAuth } from "@/app/AuthProvider"
import { LibraryPage } from "@/pages/LibraryPage"
import { AuthPage } from "@/pages/AuthPage"

const JournalsPage = lazy(() => import("@/pages/JournalsPage").then((module) => ({ default: module.JournalsPage })))
const JournalEditorPage = lazy(() => import("@/pages/JournalEditorPage").then((module) => ({ default: module.JournalEditorPage })))

function RouteFallback() {
  return <div className="route-loading" role="status">opening your journal…</div>
}

export function App() {
  const { loading, user } = useAuth()
  if (loading) return <div className="route-loading" role="status">opening memento…</div>
  if (!user) return <AuthPage />
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
