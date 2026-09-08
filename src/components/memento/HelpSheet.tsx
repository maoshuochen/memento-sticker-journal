import { LogOut, RefreshCw } from "lucide-react"

import { useAppData } from "@/app/AppDataProvider"
import { useAuth } from "@/app/AuthProvider"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

export function HelpSheet({ open, onOpenChange, onReturnFocus }: { open: boolean; onOpenChange(open: boolean): void; onReturnFocus?(): void }) {
  const { syncNow, syncStatus, syncError } = useAppData()
  const { user, logout } = useAuth()
  const statusLabel = syncStatus === "synced"
    ? "已同步"
    : syncStatus === "syncing"
      ? "正在同步…"
      : syncStatus === "offline"
        ? "离线，等待重试"
        : "同步遇到问题"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="memento-sheet help-sheet" onCloseAutoFocus={(event) => { if (onReturnFocus) { event.preventDefault(); onReturnFocus() } }}>
        <SheetHeader>
          <SheetDescription>个人中心</SheetDescription>
          <SheetTitle>Account & settings</SheetTitle>
        </SheetHeader>
        <section className="account-panel" aria-label="Account and sync status">
          <div>
            <strong>{user?.username}</strong>
            <small>你的手帐仅在已登录设备间同步。</small>
          </div>
          <div className="sync-row">
            <span data-status={syncStatus}>{statusLabel}</span>
            <Button variant="outline" size="sm" onClick={() => void syncNow()} disabled={syncStatus === "syncing"}>
              <RefreshCw className={syncStatus === "syncing" ? "is-spinning" : undefined} /> 立即同步
            </Button>
          </div>
          {syncError ? <small role="alert">{syncError}</small> : null}
          <Button variant="outline" className="account-logout" onClick={() => void logout()}>
            <LogOut /> 退出登录
          </Button>
        </section>
        <div className="account-guide">
          <p className="eyebrow">A small guide</p>
        <ol className="guide-list">
          <li><b>1</b><span><strong>Catch a moment</strong><small>拍照或从相册选择一张图片。</small></span></li>
          <li><b>2</b><span><strong>Watch it become a sticker</strong><small>图片只在你主动选择时发送到阿里云处理。</small></span></li>
          <li><b>3</b><span><strong>Make a page</strong><small>登录后，手帐会同步到你的其他设备。</small></span></li>
        </ol>
        </div>
        <Button className="wide-action" onClick={() => onOpenChange(false)}>Let's make something <span>→</span></Button>
      </SheetContent>
    </Sheet>
  )
}
