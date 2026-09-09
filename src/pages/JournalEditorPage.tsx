import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Download, Loader2, PanelTop, Plus, Redo2, Trash2, Type, Undo2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { Navigate, useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { useAppData } from "@/app/AppDataProvider"
import { useAuth } from "@/app/AuthProvider"
import { FabricJournalCanvas, type CanvasRenderState, type CanvasSelectionAnchor, type FabricJournalCanvasHandle } from "@/components/memento/FabricJournalCanvas"
import { StickerImage } from "@/components/memento/StickerImage"
import { TapePatternPicker } from "@/components/memento/TapePatternPicker"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { appendCanvasHistory, CANVAS_TEXT_COLORS, CANVAS_TEXT_FONTS, canvasDocumentFromPlacements, canvasTextFontFamily, DEFAULT_CANVAS_TAPE_COLOR, DEFAULT_CANVAS_TEXT_COLOR, DEFAULT_CANVAS_TEXT_FONT, emptyCanvasDocument, moveCanvasHistory } from "@/domain/editor"
import { isCanvasJournalPage, type CanvasDocument, type CanvasJournalPageRecord, type CanvasObject, type CanvasTapeStyle, type CanvasTextFont } from "@/domain/model"
import { shouldApplyRecord } from "@/domain/syncProtocol"
import { createCanvasWriteQueue, type CanvasOperationToken } from "@/hooks/useCanvasHistory"
import { downloadBlob } from "@/lib/images"
import { cn } from "@/lib/utils"

function drawJournalPaper(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  paper: "paper-grid" | "paper-plain" | "paper-lined" | "paper-calendar" | "paper-ledger" | "paper-sprinkle",
): void {
  context.fillStyle = "#faf7ed"
  context.fillRect(0, 0, width, height)
  context.save()
  if (paper === "paper-grid") {
    context.fillStyle = "#c7bda8"
    for (let y = 7; y < height; y += 14) for (let x = 7; x < width; x += 14) {
      context.beginPath()
      context.arc(x, y, 1, 0, Math.PI * 2)
      context.fill()
    }
  }
  if (paper === "paper-lined" || paper === "paper-ledger") {
    context.strokeStyle = "#d7cfc1"
    context.lineWidth = 1
    for (let y = 27; y < height; y += 30) {
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(width, y)
      context.stroke()
    }
  }
  if (paper === "paper-calendar") {
    context.strokeStyle = "#d7cfc1"
    context.lineWidth = 1
    for (let x = 0; x <= width; x += 64) {
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, height)
      context.stroke()
    }
    for (let y = 0; y <= height; y += 64) {
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(width, y)
      context.stroke()
    }
  }
  if (paper === "paper-ledger") {
    context.strokeStyle = "#d1c7b8"
    context.beginPath()
    context.moveTo(width * .284, 0)
    context.lineTo(width * .284, height)
    context.stroke()
  }
  if (paper === "paper-sprinkle") {
    // A deterministic scatter gives exported pages the same quiet paper feel
    // without depending on CSS Color 4 syntax that canvas exporters reject.
    for (let index = 0; index < Math.ceil(width * height / 1_300); index += 1) {
      const x = (index * 71) % width
      const y = (index * 113) % height
      context.fillStyle = index % 2 ? "rgba(168, 125, 89, .32)" : "rgba(112, 142, 169, .28)"
      context.beginPath()
      context.arc(x, y, 1, 0, Math.PI * 2)
      context.fill()
    }
  }
  context.restore()
}

export function JournalEditorPage() {
  const { journalId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { snapshot, repository, assetUrls } = useAppData()
  const journal = snapshot.journals.find((item) => item.id === journalId)
  const [pageNumber, setPageNumber] = useState(journal?.currentPage ?? 1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedTextColor, setSelectedTextColor] = useState<string | null>(null)
  const [selectedTextFont, setSelectedTextFont] = useState<CanvasTextFont | null>(null)
  const [fontPickerOpen, setFontPickerOpen] = useState(false)
  const [tapePickerOpen, setTapePickerOpen] = useState(false)
  const [tapeStylePickerOpen, setTapeStylePickerOpen] = useState(false)
  const [selectedTapeStyle, setSelectedTapeStyle] = useState<CanvasTapeStyle | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [selectedAnchor, setSelectedAnchor] = useState<CanvasSelectionAnchor | null>(null)
  const canvasRef = useRef<HTMLElement>(null)
  const fabricRef = useRef<FabricJournalCanvasHandle>(null)
  const canvasPageCacheRef = useRef(new Map<string, CanvasJournalPageRecord>())
  const [savedPages, setSavedPages] = useState<ReadonlyMap<string, CanvasJournalPageRecord>>(new Map())
  const canvasWriteQueueRef = useRef(createCanvasWriteQueue())
  const activePageIdRef = useRef<string | null>(null)
  const persistedSequenceRef = useRef(new Map<string, number>())
  const [acknowledgedOperation, setAcknowledgedOperation] = useState<CanvasOperationToken | null>(null)
  const [canvasRenderState, setCanvasRenderState] = useState<CanvasRenderState>({ pageId: null, loading: true, complete: false, hasErrors: false })

  const snapshotPage = snapshot.journalPages.find((item) => item.journalId === journalId && item.pageNumber === pageNumber)
  const savedPage = snapshotPage ? savedPages.get(snapshotPage.id) : undefined
  const page = savedPage && snapshotPage && !shouldApplyRecord(savedPage, snapshotPage) ? savedPage : snapshotPage
  const canvasPage = page && isCanvasJournalPage(page) ? page : null
  const pageId = canvasPage?.id ?? null
  const migrated = page ? canvasPage !== null : true
  const document = useMemo<CanvasDocument>(() => {
    if (!page) return emptyCanvasDocument()
    return isCanvasJournalPage(page) ? page.canvasDocument : canvasDocumentFromPlacements(page.placements)
  }, [page])

  useEffect(() => {
    activePageIdRef.current = pageId
  }, [pageId])

  const handleCanvasRenderStateChange = useCallback((state: CanvasRenderState): void => {
    if (state.pageId !== pageId) return
    setCanvasRenderState(state)
  }, [pageId])

  useEffect(() => {
    if (!canvasPage) return
    const cached = canvasPageCacheRef.current.get(canvasPage.id)
    // IndexedDB live queries can briefly report a record written just before
    // a newer local save. Never let that acknowledgement move our write base
    // backwards, or a later UI action could resurrect stale canvas state.
    if (!cached || shouldApplyRecord(cached, canvasPage)) {
      canvasPageCacheRef.current.set(canvasPage.id, canvasPage)
    }
  }, [canvasPage])

  useEffect(() => {
    if (!journal || page) return
    const timestamp = Date.now()
    void repository.putJournalPage({
      id: `${journal.id}:${pageNumber}`,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      journalId: journal.id,
      pageNumber,
      canvasDocument: emptyCanvasDocument(),
      history: { entries: [emptyCanvasDocument()], index: 0 },
    })
  }, [journal, page, pageNumber, repository])

  if (!journalId || !journal) return <Navigate to="/journals" replace />
  const activeJournal = journal

  function commitCanvas(nextDocument: CanvasDocument, operation: CanvasOperationToken): void {
    if (!operation.pageId || operation.kind !== "edit") return
    void canvasWriteQueueRef.current.enqueue(operation, async () => {
      const current = canvasPageCacheRef.current.get(operation.pageId)
      if (!current) return
      const lastPersistedSequence = persistedSequenceRef.current.get(operation.pageId) ?? 0
      if (operation.sequence <= lastPersistedSequence) return
      const next: CanvasJournalPageRecord = {
        ...current,
        canvasDocument: nextDocument,
        history: appendCanvasHistory(current.history, nextDocument),
        revision: current.revision + 1,
        updatedAt: Date.now(),
      }
      await repository.putJournalPage(next)
      canvasPageCacheRef.current.set(operation.pageId, next)
      setSavedPages((current) => new Map(current).set(operation.pageId, next))
      persistedSequenceRef.current.set(operation.pageId, operation.sequence)
      if (activePageIdRef.current === operation.pageId) setAcknowledgedOperation(operation)
    }).catch((cause: unknown) => {
      toast.error(cause instanceof Error ? cause.message : "保存这一页失败。")
    })
  }

  async function undoRedo(direction: -1 | 1): Promise<void> {
    const targetPageId = activePageIdRef.current
    if (!targetPageId) return
    const operation = canvasWriteQueueRef.current.next(targetPageId, direction < 0 ? "undo" : "redo")
    try {
      await canvasWriteQueueRef.current.enqueue(operation, async () => {
        const current = canvasPageCacheRef.current.get(targetPageId)
        if (!current) return false
        const result = moveCanvasHistory(current.history, direction)
        if (!result) return false
        const next: CanvasJournalPageRecord = {
          ...current,
          canvasDocument: result.document,
          history: result.history,
          revision: current.revision + 1,
          updatedAt: Date.now(),
        }
        await repository.putJournalPage(next)
        canvasPageCacheRef.current.set(targetPageId, next)
        setSavedPages((current) => new Map(current).set(targetPageId, next))
        persistedSequenceRef.current.set(targetPageId, operation.sequence)
        if (activePageIdRef.current === targetPageId) setAcknowledgedOperation(operation)
        return true
      })
      if (activePageIdRef.current === targetPageId) setSelectedId(null)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "无法切换历史记录。")
    }
  }

  async function changePage(next: number): Promise<void> {
    if (next < 1 || next > activeJournal.pages) return
    setAcknowledgedOperation(null)
    setCanvasRenderState({ pageId: null, loading: true, complete: false, hasErrors: false })
    setSelectedId(null)
    setSelectedTextColor(null)
    setSelectedTextFont(null)
    setFontPickerOpen(false)
    setTapePickerOpen(false)
    setTapeStylePickerOpen(false)
    setSelectedTapeStyle(null)
    setSelectedAnchor(null)
    setPageNumber(next)
    await repository.putJournal({ ...activeJournal, currentPage: next, revision: activeJournal.revision + 1, updatedAt: Date.now() })
  }

  function handleSelectedObjectChange(object: CanvasObject | null): void {
    setSelectedTextColor(object?.kind === "text" ? object.color ?? DEFAULT_CANVAS_TEXT_COLOR : null)
    setSelectedTextFont(object?.kind === "text" ? object.font ?? DEFAULT_CANVAS_TEXT_FONT : null)
    if (object?.kind !== "text") setFontPickerOpen(false)
    setSelectedTapeStyle(object?.kind === "tape" ? { color: object.color, pattern: object.pattern } : null)
    if (object?.kind !== "tape") setTapeStylePickerOpen(false)
  }

  async function addPage(): Promise<void> {
    const next = activeJournal.pages + 1
    const timestamp = Date.now()
    await repository.putJournal({ ...activeJournal, pages: next, currentPage: next, revision: activeJournal.revision + 1, updatedAt: timestamp })
    await repository.putJournalPage({
      id: `${activeJournal.id}:${next}`,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      journalId: activeJournal.id,
      pageNumber: next,
      canvasDocument: emptyCanvasDocument(),
      history: { entries: [emptyCanvasDocument()], index: 0 },
    })
    setAcknowledgedOperation(null)
    setCanvasRenderState({ pageId: null, loading: true, complete: false, hasErrors: false })
    setSelectedId(null)
    setSelectedTextColor(null)
    setSelectedTextFont(null)
    setSelectedTapeStyle(null)
    setFontPickerOpen(false)
    setTapePickerOpen(false)
    setTapeStylePickerOpen(false)
    setSelectedAnchor(null)
    setPageNumber(next)
  }

  async function exportPage(): Promise<void> {
    if (!canvasRef.current || isExporting) return
    if (!fabricRef.current?.isReadyForExport() || !canvasPage?.id || canvasRenderState.pageId !== canvasPage.id || canvasRenderState.loading || !canvasRenderState.complete || canvasRenderState.hasErrors) {
      toast.error("画布资源尚未完整加载，请重试后再导出。")
      return
    }
    setIsExporting(true)
    try {
      // Let the pressed state paint before export starts its expensive
      // canvas composition. On a phone this makes a long export feel
      // intentional instead of like a button that ignored the tap.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      if (!fabricRef.current?.isReadyForExport()) throw new Error("画布资源仍在加载，请稍后重试。")
      const fabricCanvas = canvasRef.current.querySelector<HTMLCanvasElement>(".lower-canvas")
      if (!fabricCanvas) throw new Error("画布尚未准备好，请稍后重试。")
      const width = canvasRef.current.clientWidth
      const height = canvasRef.current.clientHeight
      if (!width || !height) throw new Error("画布尺寸无效，请稍后重试。")
      // Export the Fabric lower canvas directly. html2canvas cannot parse the
      // browser-computed `lab()` values produced by modern Color 4 CSS, while
      // Fabric already owns all of the page's editable artwork.
      const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      const exportCanvas = window.document.createElement("canvas")
      exportCanvas.width = Math.round(width * scale)
      exportCanvas.height = Math.round(height * scale)
      const context = exportCanvas.getContext("2d")
      if (!context) throw new Error("浏览器无法生成导出图片。")
      context.scale(scale, scale)
      drawJournalPaper(context, width, height, activeJournal.paper)
      context.drawImage(fabricCanvas, 0, 0, width, height)
      const blob = await new Promise<Blob>((resolve, reject) => exportCanvas.toBlob((result) => result ? resolve(result) : reject(new Error("无法生成 PNG 文件。")), "image/png"))
      downloadBlob(blob, `${activeJournal.title.replace(/\s+/g, "-").toLowerCase()}-page-${pageNumber}.png`)
      toast.success("已开始下载 PNG。")
    } catch (cause) {
      toast.error(cause instanceof Error ? `导出失败：${cause.message}` : "导出失败，请重试。")
    } finally {
      setIsExporting(false)
    }
  }

  const historyIndex = canvasPage?.history.index ?? 0
  const historyLength = canvasPage?.history.entries.length ?? 1
  const objectToolbarStyle = selectedAnchor ? {
    "--object-toolbar-x": `${selectedAnchor.x}px`,
    "--object-toolbar-y": `${selectedAnchor.y}px`,
  } as CSSProperties : undefined

  return (
    <section className="journal-editor" aria-label="Journal editor">
      <header className="topbar detail-topbar">
        <button className="round-icon" aria-label="Back to my journals" onClick={() => void navigate("/journals")}><ArrowLeft /></button>
        <p className="wordmark">memento</p>
        <button className="round-icon" aria-label="Export this page" aria-busy={isExporting} disabled={isExporting || canvasRenderState.loading || !canvasRenderState.complete || canvasRenderState.hasErrors} onClick={() => void exportPage()}>
          {isExporting ? <Loader2 className="is-spinning" /> : <Download />}
        </button>
      </header>

      <section ref={canvasRef} className={cn("journal-canvas", "fabric-paper", activeJournal.paper)} role="region" aria-label="Journal canvas">
        <FabricJournalCanvas
          ref={fabricRef}
          pageId={pageId}
          document={document}
          stickers={snapshot.stickers}
          assetUrls={assetUrls}
          readOnly={!migrated}
          acknowledgedOperation={acknowledgedOperation}
          nextOperation={(id, documentKey) => canvasWriteQueueRef.current.next(id, "edit", documentKey)}
          onCommit={commitCanvas}
          onRenderStateChange={handleCanvasRenderStateChange}
          onSelectedIdChange={setSelectedId}
          onSelectedObjectChange={handleSelectedObjectChange}
          onSelectedAnchorChange={setSelectedAnchor}
        />
        {selectedId && selectedAnchor ? (
          <div className="canvas-object-actions" aria-label="Selected object actions" data-placement={selectedAnchor.placement} style={objectToolbarStyle}>
            {selectedTextColor ? (
              <div className="canvas-text-colors" role="group" aria-label="Text color">
                {CANVAS_TEXT_COLORS.map((color) => (
                  <Button
                    key={color}
                    variant="ghost"
                    size="icon-xs"
                    className={cn("canvas-text-color", selectedTextColor.toLowerCase() === color.toLowerCase() && "is-selected")}
                    aria-label={`Set text color to ${color}`}
                    aria-pressed={selectedTextColor.toLowerCase() === color.toLowerCase()}
                    style={{ backgroundColor: color }}
                    onClick={() => fabricRef.current?.setSelectedTextColor(color)}
                  />
                ))}
              </div>
            ) : null}
            {selectedTextFont ? (
              <Popover open={fontPickerOpen} onOpenChange={setFontPickerOpen}>
                <PopoverTrigger asChild><Button variant="ghost" size="icon" className="canvas-font-trigger" aria-label="Change text style" title="文字风格"><Type /></Button></PopoverTrigger>
                <PopoverContent side="bottom" sideOffset={10} className="canvas-font-picker" aria-label="Choose text style">
                  <p>文字风格</p>
                  <div role="group" aria-label="Text style options">
                    {CANVAS_TEXT_FONTS.map((font) => (
                      <Button
                        key={font.id}
                        type="button"
                        variant="ghost"
                        className={cn("canvas-font-option", selectedTextFont === font.id && "is-selected")}
                        aria-label={`Use ${font.label} text style`}
                        aria-pressed={selectedTextFont === font.id}
                        onClick={() => {
                          fabricRef.current?.setSelectedTextFont(font.id)
                          setFontPickerOpen(false)
                        }}
                      >
                        <span style={{ fontFamily: canvasTextFontFamily(font.id) }}>{font.label}</span>
                        <small>{font.description}</small>
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
            {selectedTapeStyle ? (
              <TapePatternPicker
                open={tapeStylePickerOpen}
                onOpenChange={setTapeStylePickerOpen}
                mode="edit"
                initialStyle={selectedTapeStyle}
                accountId={user?.id ?? "local"}
                trigger={<Button variant="ghost" size="icon" aria-label="Change tape style" title="胶带样式"><PanelTop /></Button>}
                onConfirm={(style) => fabricRef.current?.setSelectedTapeStyle(style)}
              />
            ) : null}
            {!selectedTextColor ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Send selected object backward" onClick={() => fabricRef.current?.sendSelectedBackward()}><ArrowDown /></Button></TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8}>下移一层</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Bring selected object forward" onClick={() => fabricRef.current?.bringSelectedForward()}><ArrowUp /></Button></TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8}>上移一层</TooltipContent>
                </Tooltip>
              </>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon" className="canvas-object-delete" aria-label="Delete selected object" onClick={() => fabricRef.current?.deleteSelected()}><Trash2 /></Button></TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>删除</TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </section>

      <div className="page-controls" aria-label="Journal editor controls">
        <div className="page-edit-groups" aria-label="Edit actions">
          <div className="page-edit-actions" aria-label="History actions">
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Undo" disabled={!migrated || historyIndex <= 0} onClick={() => void undoRedo(-1)}><Undo2 /></Button></TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>撤销</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Redo" disabled={!migrated || historyIndex >= historyLength - 1} onClick={() => void undoRedo(1)}><Redo2 /></Button></TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>重做</TooltipContent>
            </Tooltip>
          </div>
          <div className="page-edit-actions" aria-label="Create text or tape">
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon" className="canvas-text-button" aria-label="Add text" disabled={!migrated} onClick={() => fabricRef.current?.addText()}><Type /></Button></TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>添加文字</TooltipContent>
            </Tooltip>
            <TapePatternPicker
              open={tapePickerOpen}
              onOpenChange={setTapePickerOpen}
              mode="add"
              initialStyle={{ color: DEFAULT_CANVAS_TAPE_COLOR }}
              accountId={user?.id ?? "local"}
              trigger={<Button variant="ghost" size="icon" className="canvas-tape-button" aria-label="Add tape" disabled={!migrated}><PanelTop /></Button>}
              onConfirm={(style) => fabricRef.current?.addTape(style)}
            />
          </div>
        </div>
        <nav className="page-navigator" aria-label="Journal pages">
          <Tooltip>
            <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Previous page" disabled={pageNumber === 1} onClick={() => void changePage(pageNumber - 1)}><ChevronLeft /></Button></TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>上一页</TooltipContent>
          </Tooltip>
          <span aria-live="polite">{pageNumber} / {activeJournal.pages}</span>
          <Tooltip>
            <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Next page" disabled={pageNumber === activeJournal.pages} onClick={() => void changePage(pageNumber + 1)}><ChevronRight /></Button></TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>下一页</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild><Button variant="ghost" size="icon" className="new-page-button" aria-label="Add page" onClick={() => void addPage()}><Plus /></Button></TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>新增页面</TooltipContent>
          </Tooltip>
        </nav>
      </div>

      {!migrated ? <p className="canvas-migration-note">离线数据将在下一次成功同步后升级；此时仅可查看。</p> : null}
      <section className="canvas-sticker-dock" aria-label="Stickers for this page">
        <div className="canvas-sticker-scroll">
          {snapshot.stickers.map((sticker) => (
            <button key={sticker.id} className="dock-sticker" disabled={!migrated} aria-label={`Add ${sticker.name} to this page`} onClick={() => fabricRef.current?.addSticker(sticker.id)}><StickerImage sticker={sticker} /></button>
          ))}
        </div>
      </section>
    </section>
  )
}
