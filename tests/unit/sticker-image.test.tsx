// @vitest-environment jsdom

import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { StickerImage } from "@/components/memento/StickerImage"
import type { StickerRecord } from "@/domain/model"

vi.mock("@/app/AppDataProvider", () => ({
  useAppData: () => ({
    assetUrls: new Map([["asset-sample-3", "/assets/stickers/strawberry.svg"]]),
  }),
}))

const sticker: StickerRecord = {
  id: "sample-3",
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  name: "strawberry",
  group: "summer 2026",
  assetId: "asset-sample-3",
  finish: "edge-bold",
  edgeThickness: 4,
  border: "sticker-clean",
  tilt: -2,
}

describe("StickerImage", () => {
  it("renders every extracted subject as a contour cutout", () => {
    const { container } = render(<StickerImage sticker={sticker} />)

    const wrapper = container.firstElementChild
    expect(wrapper).toHaveClass("memento-sticker", "cutout", "sticker-clean", "edge-bold")
    expect(container.querySelector("img")).toHaveAttribute("src", "/assets/stickers/strawberry.svg?v=twemoji-14.0.2")
  })
})
