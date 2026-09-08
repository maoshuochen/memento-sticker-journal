// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppSnapshot } from "@/domain/model"

const fixtures = vi.hoisted(() => {
  const snapshot: AppSnapshot = {
    assets: [],
    stickers: [],
    journals: [],
    journalPages: [],
    settings: { id: "app", schemaVersion: 2, updatedAt: 1 },
  }
  return {
    snapshot,
    repository: {
      initialize: vi.fn().mockResolvedValue(undefined),
      replaceSnapshot: vi.fn().mockResolvedValue(undefined),
      migrateJournalPagesToCanvas: vi.fn().mockResolvedValue(0),
      pendingSyncCount: vi.fn().mockResolvedValue(0),
      close: vi.fn(),
    },
    localRepository: {
      initialize: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue(snapshot),
    },
    adapter: {
      initialize: vi.fn().mockResolvedValue(undefined),
      syncNow: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    },
    auth: {
      user: { id: "user-1", username: "memento" },
      sessionExpired: vi.fn(),
    },
    liveQueryCalls: 0,
  }
})

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => {
    const index = fixtures.liveQueryCalls++
    return index % 2 === 0 ? fixtures.snapshot : 0
  },
}))

vi.mock("@/app/AuthProvider", () => ({
  useAuth: () => fixtures.auth,
}))

vi.mock("@/data/repository", () => ({
  createUserRepository: () => fixtures.repository,
  localRepository: fixtures.localRepository,
}))

vi.mock("@/data/sync", () => ({
  CloudSyncAdapter: class {
    initialize = fixtures.adapter.initialize
    syncNow = fixtures.adapter.syncNow
    dispose = fixtures.adapter.dispose
  },
}))

vi.mock("@/hooks/useAssetUrls", () => ({
  useAssetUrls: () => new Map(),
}))

import { AppDataProvider, useAppData } from "@/app/AppDataProvider"

function Probe(): ReactNode {
  const { syncStatus, syncError } = useAppData()
  return <output data-testid="sync-state">{`${syncStatus}:${syncError ?? ""}`}</output>
}

describe("AppDataProvider", () => {
  beforeEach(() => {
    fixtures.liveQueryCalls = 0
    fixtures.repository.initialize.mockReset().mockResolvedValue(undefined)
    fixtures.repository.replaceSnapshot.mockReset().mockResolvedValue(undefined)
    fixtures.repository.migrateJournalPagesToCanvas.mockReset().mockResolvedValue(0)
    fixtures.repository.close.mockReset()
    fixtures.adapter.initialize.mockReset().mockResolvedValue(undefined)
    fixtures.adapter.syncNow.mockReset().mockResolvedValue(undefined)
    fixtures.adapter.dispose.mockReset()
    fixtures.auth.sessionExpired.mockReset()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders local data without waiting for network bootstrap", async () => {
    let resolveBootstrap: (() => void) | undefined
    fixtures.adapter.initialize.mockImplementation(() => new Promise<void>((resolve) => { resolveBootstrap = resolve }))

    render(<AppDataProvider><Probe /></AppDataProvider>)

    expect(screen.getByTestId("sync-state")).toBeInTheDocument()
    await waitFor(() => expect(fixtures.adapter.initialize).toHaveBeenCalledTimes(1))
    resolveBootstrap?.()
  })

  it("surfaces a classified sync failure while retaining local data", async () => {
    fixtures.adapter.initialize.mockRejectedValue(new Error("服务器暂时不可用"))

    render(<AppDataProvider><Probe /></AppDataProvider>)

    await waitFor(() => expect(screen.getByTestId("sync-state")).toHaveTextContent("error:服务器暂时不可用"))
    expect(screen.getByTestId("sync-state")).toBeInTheDocument()
  })

  it("expires the cached account when sync reports an authentication failure", async () => {
    fixtures.adapter.initialize.mockRejectedValue({ kind: "auth", message: "登录已过期" })

    render(<AppDataProvider><Probe /></AppDataProvider>)

    await waitFor(() => expect(fixtures.auth.sessionExpired).toHaveBeenCalledTimes(1))
  })
})
