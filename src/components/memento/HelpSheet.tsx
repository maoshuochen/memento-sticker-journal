import { useRef, useState } from "react"
import { toast } from "sonner"

import { useAppData } from "@/app/AppDataProvider"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { backupToSnapshot, createBackupBlob, parseBackupFile, type ParsedBackup } from "@/data/backup"
import { downloadBlob } from "@/lib/images"

export function HelpSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { repository, snapshot } = useAppData()
  const restoreInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<ParsedBackup | null>(null)

  async function exportBackup(): Promise<void> {
    const blob = await createBackupBlob(snapshot)
    downloadBlob(blob, `memento-backup-${new Date().toISOString().slice(0, 10)}.json`)
    toast.success("备份已导出。")
  }

  async function chooseBackup(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    try {
      setPending(await parseBackupFile(file))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法读取这个备份。")
    }
  }

  async function confirmRestore(): Promise<void> {
    if (!pending) return
    await repository.replaceSnapshot(await backupToSnapshot(pending))
    setPending(null)
    onOpenChange(false)
    toast.success("备份恢复完成，贴纸和手帐已校验写入。")
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="memento-sheet help-sheet">
          <SheetHeader>
            <SheetDescription>A small guide</SheetDescription>
            <SheetTitle>Keep the little things</SheetTitle>
          </SheetHeader>
          <ol className="guide-list">
            <li><b>1</b><span><strong>Catch a moment</strong><small>拍照或从相册选择一张图片。</small></span></li>
            <li><b>2</b><span><strong>Watch it become a sticker</strong><small>图片只在你主动选择时发送到阿里云处理。</small></span></li>
            <li><b>3</b><span><strong>Make a page</strong><small>数据默认保存在当前设备，可随时导出备份。</small></span></li>
          </ol>
          <div className="backup-actions">
            <Button variant="outline" onClick={() => void exportBackup()}>export backup</Button>
            <Button variant="outline" onClick={() => restoreInput.current?.click()}>restore backup</Button>
          </div>
          <Button className="wide-action" onClick={() => onOpenChange(false)}>Let's make something <span>→</span></Button>
          <input ref={restoreInput} className="sr-only" type="file" accept="application/json,.json" aria-label="Memento backup file" onChange={(event) => void chooseBackup(event)} />
        </SheetContent>
      </Sheet>

      <AlertDialog open={Boolean(pending)} onOpenChange={(next) => { if (!next) setPending(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace data on this device?</AlertDialogTitle>
            <AlertDialogDescription>备份已通过校验。继续会替换当前贴纸库和手帐；原站数据不会被删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRestore()}>Restore backup</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
