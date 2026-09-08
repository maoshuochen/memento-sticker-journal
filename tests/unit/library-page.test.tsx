// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { HTMLAttributes, ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fixtures = vi.hoisted(() => {
  const sticker = {
    id: "sample-7",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    name: "cherries",
    group: "summer 2026",
    assetId: "asset-sample-7",
    finish: "edge-soft" as const,
    edgeThickness: 3,
    border: "sticker-clean" as const,
    tilt: 2,
  }

  return {
    sticker,
    data: {
      snapshot: {
        assets: [{
          id: sticker.assetId,
          revision: 1,
          createdAt: 1,
          updatedAt: 1,
          mimeType: "image/png",
          url: "/assets/stickers/cherries.svg",
        }],
        stickers: [sticker],
        journals: [],
        journalPages: [],
        settings: { id: "app", schemaVersion: 2, updatedAt: 1 },
      },
      assetUrls: new Map([[sticker.assetId, "/assets/stickers/cherries.svg"]]),
      repository: {
        updateSticker: vi.fn().mockResolvedValue({ ...sticker }),
        deleteSticker: vi.fn().mockResolvedValue(undefined),
      },
    },
    toast: { success: vi.fn(), error: vi.fn() },
    fetch: vi.fn(),
    replay: vi.fn(),
    requestMotionPermission: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock("@/app/AppDataProvider", () => ({
  useAppData: () => fixtures.data,
}))

vi.mock("react-router", () => ({
  useOutletContext: () => ({ openAccount: vi.fn() }),
}))

vi.mock("@/hooks/useGravityDrop", () => ({
  useGravityDrop: () => ({
    shelfRef: { current: null },
    isDropping: false,
    replay: fixtures.replay,
    requestMotionPermission: fixtures.requestMotionPermission,
  }),
}))

vi.mock("@/lib/images", () => ({
  prepareStickerForRecognition: async (source: Blob) => source,
}))

vi.mock("sonner", () => ({
  toast: fixtures.toast,
}))

vi.mock("@/components/memento/StickerImage", () => ({
  StickerImage: ({ sticker }: { sticker: { name: string } }) => <img alt={sticker.name} />,
}))

vi.mock("@/components/memento/PeelPreview", () => ({
  PeelPreview: () => <div data-testid="peel-preview" />,
}))

// Keep this test focused on the detail flow instead of Radix portal behavior.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SelectValue: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: () => null,
  AlertDialogAction: () => null,
  AlertDialogCancel: () => null,
  AlertDialogContent: () => null,
  AlertDialogDescription: () => null,
  AlertDialogFooter: () => null,
  AlertDialogHeader: () => null,
  AlertDialogTitle: () => null,
}))

import { LibraryPage } from "@/pages/LibraryPage"

const imageBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

function mockRecognitionResponse(result: unknown): void {
  fixtures.fetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url === "/assets/stickers/cherries.svg") {
      return {
        ok: true,
        blob: async () => new Blob([imageBytes], { type: "image/png" }),
      } as Response
    }
    if (url === "/api/stickers/recognize") return Response.json(result)
    throw new Error(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal("fetch", fixtures.fetch)
}

describe("LibraryPage AI sticker recognition", () => {
  beforeEach(() => {
    fixtures.data.repository.updateSticker.mockReset().mockResolvedValue({ ...fixtures.sticker })
    fixtures.data.repository.deleteSticker.mockReset().mockResolvedValue(undefined)
    fixtures.fetch.mockReset()
    fixtures.toast.success.mockReset()
    fixtures.toast.error.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("fills the existing sticker name with the successful API result without saving yet", async () => {
    mockRecognitionResponse({ name: "樱桃", confidence: "high" })
    const user = userEvent.setup()
    render(<LibraryPage />)

    await user.click(screen.getByRole("button", { name: "Manage cherries" }))
    const nameInput = screen.getByLabelText("Sticker name")
    expect(nameInput).toHaveValue("cherries")

    await user.click(screen.getByRole("button", { name: "Use AI to recognize sticker name" }))

    await waitFor(() => expect(nameInput).toHaveValue("樱桃"))
    expect(fixtures.fetch).toHaveBeenCalledWith("/api/stickers/recognize", expect.objectContaining({ method: "POST" }))
    expect(fixtures.data.repository.updateSticker).not.toHaveBeenCalled()
  })

  it("keeps the current name when recognition fails", async () => {
    fixtures.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === "/assets/stickers/cherries.svg") {
        return {
          ok: true,
          blob: async () => new Blob([imageBytes], { type: "image/png" }),
        } as Response
      }
      if (url === "/api/stickers/recognize") return Response.json({ name: null, confidence: "low" })
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal("fetch", fixtures.fetch)

    const user = userEvent.setup()
    render(<LibraryPage />)
    await user.click(screen.getByRole("button", { name: "Manage cherries" }))
    const nameInput = screen.getByLabelText("Sticker name")

    await user.click(screen.getByRole("button", { name: "Use AI to recognize sticker name" }))

    await waitFor(() => expect(fixtures.fetch).toHaveBeenCalledWith("/api/stickers/recognize", expect.objectContaining({ method: "POST" })))
    expect(nameInput).toHaveValue("cherries")
    expect(fixtures.data.repository.updateSticker).not.toHaveBeenCalled()
  })
})
