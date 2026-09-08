import { describe, expect, it } from "vitest"

import { defaultAssets, defaultJournalPages, defaultStickers } from "@/data/defaults"

describe("default sticker library", () => {
  it("omits the retired drink stickers while retaining the matching assets", () => {
    expect(defaultStickers).toHaveLength(7)
    expect(defaultAssets).toHaveLength(7)
    expect(defaultStickers.map((sticker) => sticker.name)).not.toContain("iced cup")
    expect(defaultStickers.map((sticker) => sticker.name)).not.toContain("coffee note")
  })

  it("does not seed canvas stickers that point to retired defaults", () => {
    const stickers = defaultJournalPages.flatMap((page) => page.canvasDocument.objects).filter((object) => object.kind === "sticker")
    expect(stickers).not.toContainEqual(expect.objectContaining({ stickerId: "sample-1" }))
    expect(stickers).not.toContainEqual(expect.objectContaining({ stickerId: "sample-2" }))
  })
})
