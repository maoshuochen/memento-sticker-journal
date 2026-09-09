import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { CANVAS_TAPE_ICON_COLORS, CANVAS_TAPE_COLORS, DEFAULT_CANVAS_TAPE_ICON_COLOR, normalizeCanvasTapeStyle } from "@/domain/editor"
import { TAPE_EMOJI_ENTRIES, TAPE_ICON_BY_ID, TAPE_ICON_ENTRIES, TAPE_PATTERN_CATEGORIES, defaultTapeIconColor, rememberTapePattern, readRecentTapePatterns, type TapeEmojiEntry, type TapeIconDefinition, type TapePatternCategory } from "@/domain/tapePatterns"
import type { CanvasTapePattern, CanvasTapeStyle } from "@/domain/model"

type TapePickerTab = "emoji" | "icon"
type TapePickerSelectionTab = "solid" | TapePickerTab

export interface TapePatternPickerProps {
  open: boolean
  onOpenChange(open: boolean): void
  mode: "add" | "edit"
  initialStyle: CanvasTapeStyle
  accountId: string
  trigger: React.ReactElement
  onConfirm(style: CanvasTapeStyle): void
}

const COMPACT_QUERY = "(max-width: 639px)"

function useCompactViewport(): boolean {
  return React.useSyncExternalStore(
    React.useCallback((onStoreChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined
      const media = window.matchMedia(COMPACT_QUERY)
      const listener = () => onStoreChange()
      media.addEventListener?.("change", listener)
      return () => media.removeEventListener?.("change", listener)
    }, []),
    React.useCallback(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COMPACT_QUERY).matches, []),
    () => false,
  )
}

function containsQuery(label: string, keywords: readonly string[], query: string): boolean {
  if (!query) return true
  const text = [label, ...keywords].join(" ").toLocaleLowerCase()
  return text.includes(query.toLocaleLowerCase())
}

function patternForEmoji(entry: TapeEmojiEntry): CanvasTapePattern {
  return { kind: "emoji", value: entry.value }
}

function patternForIcon(entry: TapeIconDefinition, color: string): CanvasTapePattern {
  return { kind: "icon", id: entry.id, color }
}

function patternsMatch(left: CanvasTapePattern | undefined, right: CanvasTapePattern): boolean {
  if (left?.kind !== right.kind) return false
  if (left.kind === "emoji" && right.kind === "emoji") return left.value === right.value
  if (left.kind === "icon" && right.kind === "icon") return left.id === right.id && left.color.toLowerCase() === right.color.toLowerCase()
  return false
}

function requestSearchFocus(input: HTMLInputElement | null): void {
  if (!input) return
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => input.focus())
  } else {
    input.focus()
  }
}

function renderIconNode(node: TapeIconDefinition["nodes"][number], key: string): React.ReactNode {
  if (node.type === "path") return <path key={key} d={node.d} fill={node.fill} stroke={node.stroke} strokeWidth={node.strokeWidth} strokeLinecap={node.strokeLinecap} strokeLinejoin={node.strokeLinejoin} fillRule={node.fillRule} clipRule={node.clipRule} opacity={node.opacity} />
  if (node.type === "circle") return <circle key={key} cx={node.cx} cy={node.cy} r={node.r} fill={node.fill} stroke={node.stroke} strokeWidth={node.strokeWidth} strokeLinecap={node.strokeLinecap} strokeLinejoin={node.strokeLinejoin} opacity={node.opacity} />
  if (node.type === "line") return <line key={key} x1={node.x1} y1={node.y1} x2={node.x2} y2={node.y2} fill={node.fill} stroke={node.stroke} strokeWidth={node.strokeWidth} strokeLinecap={node.strokeLinecap} strokeLinejoin={node.strokeLinejoin} opacity={node.opacity} />
  if (node.type === "polyline") return <polyline key={key} points={node.points} fill={node.fill} stroke={node.stroke} strokeWidth={node.strokeWidth} strokeLinecap={node.strokeLinecap} strokeLinejoin={node.strokeLinejoin} fillRule={node.fillRule} clipRule={node.clipRule} opacity={node.opacity} />
  if (node.type === "polygon") return <polygon key={key} points={node.points} fill={node.fill} stroke={node.stroke} strokeWidth={node.strokeWidth} strokeLinecap={node.strokeLinecap} strokeLinejoin={node.strokeLinejoin} fillRule={node.fillRule} clipRule={node.clipRule} opacity={node.opacity} />
  return <rect key={key} x={node.x} y={node.y} width={node.width} height={node.height} rx={node.rx} ry={node.ry} fill={node.fill} stroke={node.stroke} strokeWidth={node.strokeWidth} strokeLinecap={node.strokeLinecap} strokeLinejoin={node.strokeLinejoin} opacity={node.opacity} />
}

function IconGlyph({ definition, color = "currentColor" }: { definition: TapeIconDefinition; color?: string }) {
  return <svg className="tape-pattern-icon" viewBox="0 0 24 24" aria-hidden="true" style={{ color }} focusable="false">{definition.nodes.map((node, index) => renderIconNode(node, `${definition.id}-${index}`))}</svg>
}

function PatternGlyph({ pattern, size = "normal" }: { pattern: CanvasTapePattern; size?: "normal" | "small" }) {
  if (pattern.kind === "emoji") return <span className={`tape-pattern-emoji tape-pattern-emoji-${size}`} aria-hidden="true">{pattern.value}</span>
  const definition = TAPE_ICON_BY_ID.get(pattern.id)
  return definition ? <IconGlyph definition={definition} color={pattern.color} /> : null
}

function PickerContent({
  mode,
  draft,
  activeTab,
  selectedTab,
  query,
  category,
  recent,
  iconColor,
  searchRef,
  setDraft,
  setActiveTab,
  setSelectedTab,
  setQuery,
  setCategory,
  setIconColor,
  markIconColorSelected,
  onBackgroundChange,
  confirm,
  onCancel,
}: {
  mode: "add" | "edit"
  draft: CanvasTapeStyle
  activeTab: TapePickerTab
  selectedTab: TapePickerSelectionTab
  query: string
  category: TapePatternCategory
  recent: CanvasTapePattern[]
  iconColor: string
  searchRef: React.RefObject<HTMLInputElement | null>
  setDraft: React.Dispatch<React.SetStateAction<CanvasTapeStyle>>
  setActiveTab(tab: TapePickerTab): void
  setSelectedTab(tab: TapePickerSelectionTab): void
  setQuery(query: string): void
  setCategory(category: TapePatternCategory): void
  setIconColor(color: string): void
  markIconColorSelected(): void
  onBackgroundChange(color: string): void
  confirm(): void
  onCancel(): void
}) {
  const [focusedIndex, setFocusedIndex] = React.useState(0)
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = React.useMemo(() => {
    if (activeTab === "emoji") {
      return TAPE_EMOJI_ENTRIES.filter((entry) => (category === "all" || entry.category === category) && containsQuery(entry.label, entry.keywords, normalizedQuery))
    }
    return TAPE_ICON_ENTRIES.filter((entry) => (category === "all" || entry.category === category) && containsQuery(entry.label, entry.keywords, normalizedQuery))
  }, [activeTab, category, normalizedQuery])
  const recentEntries = recent.filter((pattern) => pattern.kind === (activeTab === "emoji" ? "emoji" : "icon"))
  const activeIcon = draft.pattern?.kind === "icon" ? TAPE_ICON_BY_ID.get(draft.pattern.id) : undefined

  const focusItem = (index: number, count: number): void => {
    if (!count) return
    const next = Math.min(count - 1, Math.max(0, index))
    setFocusedIndex(next)
    window.requestAnimationFrame?.(() => itemRefs.current[next]?.focus())
  }

  const chooseEmoji = (pattern: CanvasTapePattern, index: number): void => {
    if (pattern.kind !== "emoji") return
    setDraft((current) => ({ color: current.color, pattern }))
    setActiveTab("emoji")
    setSelectedTab("emoji")
    setFocusedIndex(index)
  }
  const chooseIcon = (pattern: CanvasTapePattern, index: number): void => {
    if (pattern.kind !== "icon") return
    setDraft((current) => ({ color: current.color, pattern: { ...pattern, color: iconColor } }))
    setActiveTab("icon")
    setSelectedTab("icon")
    setIconColor(pattern.color)
    setFocusedIndex(index)
  }
  const onGridKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number, count: number): void => {
    const columns = 6
    if (event.key === "ArrowRight") { event.preventDefault(); focusItem((index + 1) % count, count) }
    if (event.key === "ArrowLeft") { event.preventDefault(); focusItem((index - 1 + count) % count, count) }
    if (event.key === "ArrowDown") { event.preventDefault(); focusItem(Math.min(count - 1, index + columns), count) }
    if (event.key === "ArrowUp") { event.preventDefault(); focusItem(Math.max(0, index - columns), count) }
    if (event.key === "Home") { event.preventDefault(); focusItem(0, count) }
    if (event.key === "End") { event.preventDefault(); focusItem(count - 1, count) }
  }

  const visibleCategories = TAPE_PATTERN_CATEGORIES
  const palette = activeTab === "icon" ? CANVAS_TAPE_ICON_COLORS : []

  return (
    <div className="tape-pattern-picker" data-mode={mode}>
      <div className="tape-pattern-live-preview" role="img" style={{ backgroundColor: draft.color }} aria-label="Tape preview">
        {Array.from({ length: 7 }, (_, index) => <span key={index} className="tape-pattern-preview-item"><PatternGlyph pattern={draft.pattern ?? { kind: "emoji", value: "" }} /></span>)}
        {!draft.pattern ? <span className="tape-pattern-preview-empty" aria-hidden="true" /> : null}
      </div>

      <div className="tape-pattern-colors" aria-label="Tape background colors">
        {CANVAS_TAPE_COLORS.map((color) => <button key={color} type="button" className={`tape-pattern-color ${draft.color === color ? "is-selected" : ""}`} style={{ backgroundColor: color }} aria-label={`胶带底色 ${color}`} aria-pressed={draft.color === color} onClick={() => onBackgroundChange(color)} />)}
      </div>

      <div className="tape-pattern-tabs" role="tablist" aria-label="Tape pattern type">
        <button type="button" role="tab" aria-selected={selectedTab === "solid"} className={selectedTab === "solid" ? "is-selected" : ""} onClick={() => { setSelectedTab("solid"); setDraft((current) => ({ color: current.color })) }}>纯色</button>
        <button type="button" role="tab" aria-selected={selectedTab === "emoji"} className={selectedTab === "emoji" ? "is-selected" : ""} onClick={() => { setSelectedTab("emoji"); setActiveTab("emoji"); setCategory("all") }}>Emoji</button>
        <button type="button" role="tab" aria-selected={selectedTab === "icon"} className={selectedTab === "icon" ? "is-selected" : ""} onClick={() => { setSelectedTab("icon"); setActiveTab("icon"); setCategory("all") }}>Icons</button>
      </div>

      <div className="tape-pattern-search-wrap">
        <span aria-hidden="true">⌕</span>
        <Input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setFocusedIndex(0) }} placeholder="搜索图案…" aria-label="搜索胶带图案" />
        {query ? <button type="button" aria-label="清空搜索" onClick={() => { setQuery(""); setFocusedIndex(0) }}>×</button> : null}
      </div>

      {activeTab === "icon" ? <div className="tape-pattern-icon-colors" aria-label="Icon colors">
        {palette.map((color) => <button key={color} type="button" className={`tape-pattern-icon-color ${iconColor === color ? "is-selected" : ""}`} style={{ backgroundColor: color }} aria-label={`图标颜色 ${color}`} aria-pressed={iconColor === color} onClick={() => { markIconColorSelected(); setIconColor(color); setDraft((current) => current.pattern?.kind === "icon" ? { ...current, pattern: { ...current.pattern, color } } : current) }} />)}
      </div> : null}

      <div className="tape-pattern-categories" role="group" aria-label="Pattern categories">
        {visibleCategories.map((option) => <button key={option.id} type="button" className={category === option.id ? "is-selected" : ""} aria-pressed={category === option.id} onClick={() => { setCategory(option.id); setFocusedIndex(0) }}>{option.label}</button>)}
      </div>

      {recentEntries.length ? <section className="tape-pattern-recent" aria-labelledby="tape-pattern-recent-heading">
        <h3 id="tape-pattern-recent-heading">最近使用</h3>
        <div className="tape-pattern-grid tape-pattern-grid-recent">
          {recentEntries.map((pattern, index) => <button key={`${pattern.kind}-${pattern.kind === "emoji" ? pattern.value : pattern.id}-${index}`} type="button" className="tape-pattern-item" aria-label={pattern.kind === "emoji" ? `最近 ${pattern.value}` : `最近 ${TAPE_ICON_BY_ID.get(pattern.id)?.label ?? pattern.id}`} onClick={() => pattern.kind === "emoji" ? chooseEmoji(pattern, index) : chooseIcon(pattern, index)}>{<PatternGlyph pattern={pattern} size="small" />}</button>)}
        </div>
      </section> : null}

      <section className="tape-pattern-results" aria-label={activeTab === "emoji" ? "Emoji patterns" : "Icon patterns"}>
        <div className="tape-pattern-results-heading"><h3>{activeTab === "emoji" ? "Emoji" : "Icons"}</h3><span>{filteredEntries.length}</span></div>
        {filteredEntries.length ? <div className="tape-pattern-grid" role="listbox" aria-label={activeTab === "emoji" ? "Emoji 图案" : "Icon 图案"}>
          {filteredEntries.map((entry, index) => {
            const pattern = activeTab === "emoji" ? patternForEmoji(entry as TapeEmojiEntry) : patternForIcon(entry as TapeIconDefinition, iconColor)
            const label = activeTab === "emoji" ? (entry as TapeEmojiEntry).label : (entry as TapeIconDefinition).label
            return <button key={activeTab === "emoji" ? (entry as TapeEmojiEntry).value : (entry as TapeIconDefinition).id} ref={(element) => { itemRefs.current[index] = element }} type="button" role="option" tabIndex={focusedIndex === index ? 0 : -1} className={`tape-pattern-item ${patternsMatch(draft.pattern, pattern) ? "is-selected" : ""}`} aria-label={label} aria-selected={patternsMatch(draft.pattern, pattern)} onFocus={() => setFocusedIndex(index)} onKeyDown={(event) => onGridKeyDown(event, index, filteredEntries.length)} onClick={() => activeTab === "emoji" ? chooseEmoji(pattern, index) : chooseIcon(pattern, index)}>{<PatternGlyph pattern={pattern} />}</button>
          })}
        </div> : <p className="tape-pattern-empty">没有找到匹配图案</p>}
      </section>

      <div className="tape-pattern-actions">
        <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
        <Button type="button" onClick={confirm}>{mode === "edit" ? "完成" : "添加胶带"}</Button>
      </div>

      <span className="sr-only">{activeIcon ? `当前图标 ${activeIcon.label}` : defaultTapeIconColor(draft.color) === DEFAULT_CANVAS_TAPE_ICON_COLOR ? "默认图标颜色" : ""}</span>
    </div>
  )
}

export function TapePatternPicker({ open, onOpenChange, mode, initialStyle, accountId, trigger, onConfirm }: TapePatternPickerProps) {
  const compact = useCompactViewport()
  const initial = React.useMemo(() => normalizeCanvasTapeStyle(initialStyle), [initialStyle])
  const [draft, setDraft] = React.useState<CanvasTapeStyle>(initial)
  const [activeTab, setActiveTab] = React.useState<TapePickerTab>(initial.pattern?.kind === "icon" ? "icon" : "emoji")
  const [selectedTab, setSelectedTab] = React.useState<TapePickerSelectionTab>(initial.pattern?.kind ?? "solid")
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState<TapePatternCategory>("all")
  const [recent, setRecent] = React.useState<CanvasTapePattern[]>(() => readRecentTapePatterns(accountId))
  const [iconColor, setIconColor] = React.useState(initial.pattern?.kind === "icon" ? initial.pattern.color : defaultTapeIconColor(initial.color))
  const searchRef = React.useRef<HTMLInputElement>(null)
  const confirmingRef = React.useRef(false)
  const iconColorTouchedRef = React.useRef(initial.pattern?.kind === "icon")

  const prepareOpen = (): void => {
    const next = normalizeCanvasTapeStyle(initialStyle)
    setDraft(next)
    setActiveTab(next.pattern?.kind === "icon" ? "icon" : "emoji")
    setSelectedTab(next.pattern?.kind ?? "solid")
    setQuery("")
    setCategory("all")
    setRecent(readRecentTapePatterns(accountId))
    setIconColor(next.pattern?.kind === "icon" ? next.pattern.color : defaultTapeIconColor(next.color))
    iconColorTouchedRef.current = next.pattern?.kind === "icon"
  }

  const handleOpenChange = (next: boolean): void => {
    if (next) prepareOpen()
    onOpenChange(next)
  }

  const confirm = (): void => {
    if (confirmingRef.current) return
    confirmingRef.current = true
    const next = normalizeCanvasTapeStyle(draft)
    if (next.pattern) {
      rememberTapePattern(accountId, next.pattern)
      setRecent(readRecentTapePatterns(accountId))
    }
    onConfirm(next)
    onOpenChange(false)
    queueMicrotask(() => { confirmingRef.current = false })
  }

  const onBackgroundChange = (color: string): void => {
    const nextIconColor = defaultTapeIconColor(color)
    setDraft((current) => current.pattern?.kind === "icon" && !iconColorTouchedRef.current
      ? { color, pattern: { ...current.pattern, color: nextIconColor } }
      : { ...current, color })
    if (!iconColorTouchedRef.current) setIconColor(nextIconColor)
  }

  const markIconColorSelected = (): void => {
    iconColorTouchedRef.current = true
  }

  const content = <PickerContent mode={mode} draft={draft} activeTab={activeTab} selectedTab={selectedTab} query={query} category={category} recent={recent} iconColor={iconColor} searchRef={searchRef} setDraft={setDraft} setActiveTab={setActiveTab} setSelectedTab={setSelectedTab} setQuery={setQuery} setCategory={setCategory} setIconColor={setIconColor} markIconColorSelected={markIconColorSelected} onBackgroundChange={onBackgroundChange} confirm={confirm} onCancel={() => onOpenChange(false)} />

  if (compact) {
    return <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetPrimitive.Trigger asChild>{trigger}</SheetPrimitive.Trigger>
      <SheetContent side="bottom" showCloseButton className="tape-pattern-sheet" onOpenAutoFocus={(event) => { event.preventDefault(); requestSearchFocus(searchRef.current) }}>
        <SheetHeader><SheetTitle>选择胶带图案</SheetTitle><SheetDescription>选一个重复图案，让手帐更有节奏。</SheetDescription></SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  }

  return <Popover open={open} onOpenChange={handleOpenChange}>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent align="center" sideOffset={10} className="tape-pattern-popover" aria-label="选择胶带图案" onOpenAutoFocus={(event) => { event.preventDefault(); requestSearchFocus(searchRef.current) }}>
      {content}
    </PopoverContent>
  </Popover>
}
