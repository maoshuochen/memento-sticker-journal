import { useLiveQuery } from "dexie-react-hooks"
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { useAuth } from "@/app/AuthProvider"
import { createUserRepository, localRepository, type LocalRepository } from "@/data/repository"
import { CloudSyncAdapter } from "@/data/sync"
import type { AppSnapshot } from "@/domain/model"
import { useAssetUrls } from "@/hooks/useAssetUrls"

type SyncStatus = "synced" | "syncing" | "offline" | "error"
type SyncFailureKind = "offline" | "auth" | "invalid" | "server"

const disposedAdapters = new WeakSet<CloudSyncAdapter>()
const migrationTasks = new WeakMap<CloudSyncAdapter, Promise<void>>()

interface AppDataContextValue {
  snapshot: AppSnapshot;
  repository: LocalRepository;
  assetUrls: ReadonlyMap<string, string>;
  syncStatus: SyncStatus;
  syncError: string | null;
  syncNow(): Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

function syncFailure(cause: unknown): { kind: SyncFailureKind; message: string } {
  const candidate = cause as { kind?: unknown; message?: unknown } | null
  const kind = candidate?.kind === "offline" || candidate?.kind === "auth" || candidate?.kind === "invalid" || candidate?.kind === "server"
    ? candidate.kind
    : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "server"
  return { kind, message: typeof candidate?.message === "string" && candidate.message ? candidate.message : "云同步失败，请稍后重试。" }
}

function disposeSyncAdapter(adapter: CloudSyncAdapter): void {
  disposedAdapters.add(adapter)
  adapter.dispose()
}

function migrateAfterSync(adapter: CloudSyncAdapter, repository: LocalRepository): Promise<void> {
  const existing = migrationTasks.get(adapter)
  if (existing) return existing
  const task = (async (): Promise<void> => {
    const migrated = await repository.migrateJournalPagesToCanvas()
    if (migrated) await adapter.syncNow()
  })()
  migrationTasks.set(adapter, task)
  void task.then(
    () => { if (migrationTasks.get(adapter) === task) migrationTasks.delete(adapter) },
    () => { if (migrationTasks.get(adapter) === task) migrationTasks.delete(adapter) },
  )
  return task
}

function AccountDataProvider({ children }: { children: ReactNode }) {
  const { user, sessionExpired } = useAuth()
  const [ready, setReady] = useState(false)
  const [initializationError, setInitializationError] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("offline")
  const [syncError, setSyncError] = useState<string | null>(null)
  const [assetRetryKey, setAssetRetryKey] = useState(0)
  const repository = useMemo(() => user ? createUserRepository(user.id) : null, [user])
  const [sync, setSync] = useState<CloudSyncAdapter | null>(null)

  const reportSyncFailure = useCallback((cause: unknown): void => {
    const failure = syncFailure(cause)
    setSyncError(failure.message)
    setSyncStatus(failure.kind === "offline" ? "offline" : "error")
    if (failure.kind === "auth") sessionExpired()
  }, [sessionExpired])

  const syncNow = useCallback(async (): Promise<void> => {
    setAssetRetryKey((current) => current + 1)
    const adapter = sync
    if (!adapter) return
    setSyncStatus("syncing")
    setSyncError(null)
    try {
      await adapter.syncNow()
      if (disposedAdapters.has(adapter)) return
      if (repository) await migrateAfterSync(adapter, repository)
      if (disposedAdapters.has(adapter)) return
      setSyncStatus("synced")
    } catch (cause) {
      if (disposedAdapters.has(adapter)) return
      reportSyncFailure(cause)
    }
  }, [reportSyncFailure, repository, sync])

  useEffect(() => {
    if (!user || !repository) {
      setReady(false)
      setSync(null)
      return
    }
    let active = true
    let adapter: CloudSyncAdapter | null = null
    setReady(false)
    setInitializationError(null)
    setSyncStatus("syncing")
    setSyncError(null)
    const start = async (): Promise<void> => {
      try {
        // StrictMode cancels its first setup before it may open a shared database.
        await Promise.resolve()
        if (!active) return
        await repository.initialize()
        if (!active) return
        if (sessionStorage.getItem("memento-new-user") === user.id) {
          await localRepository.initialize()
          await repository.replaceSnapshot(await localRepository.snapshot())
          sessionStorage.removeItem("memento-new-user")
        }
        if (!active) return

        // Local data becomes usable immediately. Network bootstrap continues in
        // the background and performs page migration only after its first merge.
        setReady(true)
        adapter = new CloudSyncAdapter(repository, user.id)
        setSync(adapter)
        void (async (): Promise<void> => {
          try {
            await adapter?.initialize()
            if (!active || !adapter) return
            await migrateAfterSync(adapter, repository)
            if (active) {
              setSyncStatus("synced")
              setSyncError(null)
            }
          } catch (cause) {
            if (active) reportSyncFailure(cause)
          }
        })()
      } catch (cause) {
        if (!active) return
        setSyncStatus("offline")
        setInitializationError(cause instanceof Error ? cause.message : "无法打开本地数据。")
      }
    }
    void start()
    return () => {
      active = false
      if (adapter) disposeSyncAdapter(adapter)
      repository.close()
      setSync(null)
    }
  }, [reportSyncFailure, repository, user])

  const snapshot = useLiveQuery(async () => ready && repository ? await repository.snapshot() : undefined, [ready, repository])
  const pendingSyncCount = useLiveQuery(async () => {
    if (!ready || !repository) return 0
    try {
      return await repository.pendingSyncCount()
    } catch {
      // The background adapter creates syncProgress during bootstrap.
      return 0
    }
  }, [ready, repository]) ?? 0
  const assetUrls = useAssetUrls(snapshot, repository, assetRetryKey, sessionExpired)

  useEffect(() => {
    if (ready && sync && pendingSyncCount > 0) void syncNow()
  }, [pendingSyncCount, ready, sync, syncNow])

  useEffect(() => {
    const onOnline = () => { void syncNow() }
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [syncNow])

  const value = snapshot && repository ? { snapshot, repository, assetUrls, syncStatus, syncError, syncNow } : null

  if (!user) return <>{children}</>
  if (initializationError) {
    return <main className="data-error" role="alert"><p className="wordmark">memento</p><h1>无法打开本地数据</h1><p>{initializationError}</p><button type="button" onClick={() => window.location.reload()}>重新尝试</button></main>
  }
  if (!value) return <main className="grid min-h-svh place-items-center bg-background text-foreground" aria-busy="true"><p className="font-serif text-2xl">memento</p></main>
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return user ? <AccountDataProvider key={user.id}>{children}</AccountDataProvider> : <>{children}</>
}

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext)
  if (!value) throw new Error("useAppData must be used inside AppDataProvider.")
  return value
}
