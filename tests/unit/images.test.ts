// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"

import { optimizeStickerStorage } from "@/lib/images"

describe("sticker storage optimization", () => {
  it("keeps the PNG when a browser cannot encode WebP", async () => {
    const close = vi.fn()
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1, height: 1, close }))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })))
    const source = new Blob(["a much larger transparent source"], { type: "image/png" })

    await expect(optimizeStickerStorage(source)).resolves.toBe(source)
    expect(close).toHaveBeenCalledOnce()
  })
})
