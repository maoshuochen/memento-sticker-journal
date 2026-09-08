// @vitest-environment jsdom

import { StrictMode } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAssetUrls } from "@/hooks/useAssetUrls"
import type { LocalRepository } from "@/data/repository"
import type { AppSnapshot, AssetRecord } from "@/domain/model"

const asset: AssetRecord = {
  id: "asset-remote",
  revision: 2,
  createdAt: 1,
  updatedAt: 2,
  role: "render",
  mimeType: "image/png",
  remoteKey: "users/user-1/assets/asset-remote",
}

const snapshot: AppSnapshot = {
  assets: [asset],
  stickers: [],
  journals: [],
  journalPages: [],
  settings: { id: "app", schemaVersion: 2, updatedAt: 2 },
}

function makeRepository(cacheAssetBlob = vi.fn().mockResolvedValue(true)): LocalRepository {
  return { cacheAssetBlob } as unknown as LocalRepository
}

function AssetUrlProbe({ repository, retryKey = 0, currentSnapshot = snapshot }: {
  repository: LocalRepository
  retryKey?: number
  currentSnapshot?: AppSnapshot
}) {
  const urls = useAssetUrls(currentSnapshot, repository, retryKey)
  return <output data-testid="asset-url">{urls.get(asset.id) ?? ""}</output>
}

describe("useAssetUrls", () => {
  const createObjectURL = vi.fn(() => "blob:asset")
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL })
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("persists a valid remote blob and exposes its object URL", async () => {
    const cacheAssetBlob = vi.fn().mockResolvedValue(true)
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["sticker"], { type: "image/png" }),
    } as Response)
    const repository = makeRepository(cacheAssetBlob)

    render(<AssetUrlProbe repository={repository} />)

    await waitFor(() => expect(screen.getByTestId("asset-url")).toHaveTextContent("blob:asset"))
    expect(cacheAssetBlob).toHaveBeenCalledWith(asset, expect.any(Blob))
    expect(fetch).toHaveBeenCalledWith(`/api/assets/${asset.id}`, expect.objectContaining({ cache: "no-store" }))
  })

  it("retries transient server errors, then stops after the finite budget", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 502 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
    const repository = makeRepository()

    render(<AssetUrlProbe repository={repository} />)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3), { timeout: 3_000 })
    expect(screen.getByTestId("asset-url")).toHaveTextContent("")
    expect(repository.cacheAssetBlob).not.toHaveBeenCalled()
  })

  it("does not retry a not-found response until the caller requests a retry", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => new Blob(["sticker"], { type: "image/png" }),
      } as Response)
    const repository = makeRepository()
    const view = render(<AssetUrlProbe repository={repository} />)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    view.rerender(<AssetUrlProbe repository={repository} retryKey={1} />)
    await waitFor(() => expect(screen.getByTestId("asset-url")).toHaveTextContent("blob:asset"))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("ignores a response that belongs to a previous account", async () => {
    const resolvers: Array<(response: Response) => void> = []
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => { resolvers.push(resolve) }))
    const firstRepository = makeRepository()
    const secondRepository = makeRepository()
    const view = render(<AssetUrlProbe repository={firstRepository} />)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    view.rerender(<AssetUrlProbe repository={secondRepository} />)
    resolvers[0]?.({
      ok: true,
      status: 200,
      blob: async () => new Blob(["old"], { type: "image/png" }),
    } as Response)

    await waitFor(() => expect(firstRepository.cacheAssetBlob).not.toHaveBeenCalled())
    expect(screen.getByTestId("asset-url")).toBeEmptyDOMElement()
  })
  it("survives StrictMode remount and revokes its final URL on unmount", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(["sticker"], { type: "image/png" }) } as Response)
    const view = render(<StrictMode><AssetUrlProbe repository={makeRepository()} /></StrictMode>)
    await waitFor(() => expect(screen.getByTestId("asset-url")).toHaveTextContent("blob:asset"))
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:asset")
  })

})
