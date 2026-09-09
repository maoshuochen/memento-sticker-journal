// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { TapePatternPicker } from "@/components/memento/TapePatternPicker"
import { normalizeCanvasDocument } from "@/domain/canvasDocument"
import { normalizeCanvasTapeStyle } from "@/domain/editor"
import { canvasTapeObjectSchema, canvasTapePatternSchema, type CanvasTapeStyle } from "@/domain/model"
import { TAPE_EMOJI_ENTRIES, TAPE_ICON_ENTRIES, defaultTapeIconColor, readRecentTapePatterns, rememberTapePattern } from "@/domain/tapePatterns"

describe("tape pattern model", () => {
  it("keeps the legacy solid tape schema and normalizes patterned tapes", () => {
    const legacy = canvasTapeObjectSchema.parse({ id: "tape-legacy", kind: "tape", color: "#e9b982", x: .5, y: .5, width: .4, height: .05, angle: 0, zIndex: 1 })
    expect(legacy).not.toHaveProperty("pattern")
    const patterned = canvasTapeObjectSchema.parse({ ...legacy, pattern: { kind: "emoji", value: "🐱" } })
    const normalized = normalizeCanvasDocument({ version: 1, objects: [patterned] })
    expect(normalized.objects[0]).toEqual(expect.objectContaining({ pattern: { kind: "emoji", value: "🐱" } }))
  })

  it("round trips emoji and icon patterns while rejecting invalid values", () => {
    const emoji = canvasTapePatternSchema.parse({ kind: "emoji", value: "👩‍💻" })
    const icon = canvasTapePatternSchema.parse({ kind: "icon", id: "heart", color: "#765c49", style: "filled" })
    expect(emoji).toEqual({ kind: "emoji", value: "👩‍💻" })
    expect(icon).toEqual({ kind: "icon", id: "heart", color: "#765c49", style: "filled" })
    expect(canvasTapePatternSchema.safeParse({ kind: "emoji", value: "ab" }).success).toBe(false)
    expect(canvasTapePatternSchema.safeParse({ kind: "emoji", value: "a" }).success).toBe(false)
    expect(canvasTapePatternSchema.safeParse({ kind: "icon", id: "not-an-icon", color: "#5b4332" }).success).toBe(false)
    expect(canvasTapePatternSchema.safeParse({ kind: "icon", id: "heart", color: "brown" }).success).toBe(false)
    expect(canvasTapePatternSchema.safeParse({ kind: "icon", id: "heart", color: "#765c49", style: "duotone" }).success).toBe(false)
  })

  it("exposes the curated catalogue and background-aware icon defaults", () => {
    expect(TAPE_EMOJI_ENTRIES.length).toBeGreaterThanOrEqual(80)
    expect(TAPE_ICON_ENTRIES.length).toBe(40)
    expect(defaultTapeIconColor("#b8d0c0")).toBe("#4f7c6d")
    expect(defaultTapeIconColor("#ffffff")).toBe("#765c49")
    expect(normalizeCanvasTapeStyle({ color: "#e6b1c0", pattern: { kind: "icon", id: "heart", color: "#956573", style: "filled" } })).toEqual({ color: "#e6b1c0", pattern: { kind: "icon", id: "heart", color: "#956573", style: "filled" } })
  })
})

describe("tape pattern recent storage", () => {
  beforeEach(() => localStorage.clear())

  it("validates, deduplicates and limits account-local recent patterns", () => {
    for (let index = 0; index < 14; index += 1) {
      rememberTapePattern("account-a", { kind: "emoji", value: TAPE_EMOJI_ENTRIES[index]?.value ?? "😀" })
    }
    rememberTapePattern("account-a", { kind: "emoji", value: "😀" })
    rememberTapePattern("account-b", { kind: "emoji", value: "🐱" })
    expect(readRecentTapePatterns("account-a")).toHaveLength(12)
    expect(readRecentTapePatterns("account-a")[0]).toEqual({ kind: "emoji", value: "😀" })
    expect(readRecentTapePatterns("account-b")).toEqual([{ kind: "emoji", value: "🐱" }])
    localStorage.setItem("memento:tape-patterns:v1:account-a", JSON.stringify({ version: 0, items: [{ kind: "emoji", value: "😀" }] }))
    expect(readRecentTapePatterns("account-a")).toEqual([])
  })
})

function PickerHarness({ initialStyle = { color: "#e9b982" } }: { initialStyle?: CanvasTapeStyle }) {
  const [open, setOpen] = React.useState(false)
  const [confirmed, setConfirmed] = React.useState<CanvasTapeStyle | null>(null)
  return <>
    <TapePatternPicker open={open} onOpenChange={setOpen} mode="add" initialStyle={initialStyle} accountId="picker-account" trigger={<button type="button">打开选择器</button>} onConfirm={setConfirmed} />
    <output data-testid="confirmed">{confirmed ? JSON.stringify(confirmed) : ""}</output>
  </>
}

describe("TapePatternPicker", () => {
  afterEach(() => cleanup())
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: query.includes("max-width") && window.innerWidth < 640, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }) })
    window.innerWidth = 1024
  })

  it("chooses an emoji, confirms once and restores focus without search", async () => {
    render(<PickerHarness />)
    const trigger = screen.getByRole("button", { name: "打开选择器" })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: "苹果" })).toBeVisible()
    fireEvent.click(screen.getByRole("option", { name: "苹果" }))
    fireEvent.click(screen.getByRole("button", { name: "添加胶带" }))
    const confirmed = screen.getByTestId("confirmed")
    expect(confirmed).toHaveTextContent('"value":"🍎"')
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("supports icon color selection and roving keyboard navigation", async () => {
    render(<PickerHarness initialStyle={{ color: "#b8d0c0" }} />)
    fireEvent.click(screen.getByRole("button", { name: "打开选择器" }))
    const iconTab = screen.getByRole("tab", { name: "Icons" })
    fireEvent.click(iconTab)
    expect(iconTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "纯色" })).toHaveAttribute("aria-selected", "false")
    expect(screen.getByLabelText("图标颜色 #4f7c6d")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "面形" }))
    const grid = screen.getByRole("listbox", { name: "Icon 图案" })
    const first = within(grid).getAllByRole("option")[0]
    first.focus()
    fireEvent.keyDown(first, { key: "ArrowRight" })
    await waitFor(() => expect(within(grid).getAllByRole("option")[1]).toHaveFocus())
    fireEvent.click(within(grid).getByRole("option", { name: "心" }))
    fireEvent.click(screen.getByRole("button", { name: "添加胶带" }))
    expect(screen.getByTestId("confirmed")).toHaveTextContent('"id":"heart"')
    expect(screen.getByTestId("confirmed")).toHaveTextContent('"color":"#4f7c6d"')
    expect(screen.getByTestId("confirmed")).toHaveTextContent('"style":"filled"')
  })

  it("shows account recents and can clear a patterned tape to solid", () => {
    rememberTapePattern("picker-account", { kind: "emoji", value: "🐱" })
    render(<PickerHarness initialStyle={{ color: "#e6b1c0", pattern: { kind: "emoji", value: "🍎" } }} />)
    fireEvent.click(screen.getByRole("button", { name: "打开选择器" }))
    expect(screen.getByRole("button", { name: "最近 🐱" })).toBeVisible()
    fireEvent.click(screen.getByRole("tab", { name: "纯色" }))
    fireEvent.click(screen.getByRole("button", { name: "添加胶带" }))
    expect(screen.getByTestId("confirmed")).toHaveTextContent('{"color":"#e6b1c0"}')
  })

  it("filters the catalogue by category", () => {
    render(<PickerHarness />)
    fireEvent.click(screen.getByRole("button", { name: "打开选择器" }))
    fireEvent.click(screen.getByRole("button", { name: "自然" }))
    const grid = screen.getByRole("listbox", { name: "Emoji 图案" })
    expect(within(grid).getByRole("option", { name: "猫咪" })).toBeVisible()
    expect(within(grid).queryByRole("option", { name: "苹果" })).not.toBeInTheDocument()
  })

  it("follows the background-aware default until an icon color is chosen", () => {
    render(<PickerHarness />)
    fireEvent.click(screen.getByRole("button", { name: "打开选择器" }))
    fireEvent.click(screen.getByRole("tab", { name: "Icons" }))
    fireEvent.click(screen.getByRole("option", { name: "心" }))
    fireEvent.click(screen.getByRole("button", { name: "胶带底色 #b8d0c0" }))
    fireEvent.click(screen.getByRole("button", { name: "添加胶带" }))
    expect(screen.getByTestId("confirmed")).toHaveTextContent('"color":"#4f7c6d"')

    render(<PickerHarness />)
    fireEvent.click(screen.getAllByRole("button", { name: "打开选择器" })[1]!)
    fireEvent.click(screen.getByRole("tab", { name: "Icons" }))
    fireEvent.click(screen.getByRole("option", { name: "心" }))
    fireEvent.click(screen.getByRole("button", { name: "图标颜色 #856698" }))
    fireEvent.click(screen.getByRole("button", { name: "胶带底色 #b8d0c0" }))
    fireEvent.click(screen.getByRole("button", { name: "添加胶带" }))
    expect(screen.getAllByTestId("confirmed")[1]).toHaveTextContent('"color":"#856698"')
  })

  it("switches to a compact sheet at phone width", () => {
    window.innerWidth = 320
    render(<PickerHarness />)
    fireEvent.click(screen.getByRole("button", { name: "打开选择器" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "定制胶带" })).toBeInTheDocument()
  })
})
