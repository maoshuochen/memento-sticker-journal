import { describe, expect, it } from "vitest"

import { normalizeLegacyState } from "@/data/legacy"

describe("v1 data migration", () => {
  it("separates sticker image blobs and keeps journal page content", async () => {
    const normalized = await normalizeLegacyState({
      photos: [{
        id: "legacy-sticker",
        name: "tiny dot",
        image: "data:image/png;base64,iVBORw0KGgo=",
        group: "everyday",
        createdAt: 12,
      }],
      journals: [{
        id: "legacy-journal",
        title: "Old pages",
        year: "2025",
        pages: 1,
        page: 1,
        cover: "cover-blue",
        paper: "paper-grid",
        pageContents: { "1": [{ id: "legacy-sticker", left: 8, top: 9, angle: 2, scale: 1, zIndex: 3 }] },
      }],
    })

    expect(normalized.assets[0]?.blob).toBeInstanceOf(Blob)
    expect(normalized.stickers[0]?.assetId).toBe("asset-legacy-sticker")
    expect(normalized.journalPages[0]?.placements[0]?.id).toBe("legacy-sticker")
    expect(normalized.settings.legacyMigrationComplete).toBe(true)
  })
})
