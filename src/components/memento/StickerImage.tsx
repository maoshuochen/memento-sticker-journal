import type { CSSProperties } from "react"

import { useAppData } from "@/app/AppDataProvider"
import type { StickerRecord } from "@/domain/model"
import { cn } from "@/lib/utils"

export function StickerImage({
  sticker,
  className,
  showName = false,
  style,
}: {
  sticker: StickerRecord
  className?: string
  showName?: boolean
  style?: CSSProperties
}) {
  const { assetUrls } = useAppData()
  const source = assetUrls.get(sticker.assetId)

  return (
    <span
      className={cn("memento-sticker", sticker.border, sticker.finish, className)}
      style={{ "--sticker-tilt": `${sticker.tilt}deg`, "--edge": `${sticker.edgeThickness}px`, ...style } as CSSProperties}
    >
      {source ? <img src={source} alt="" draggable={false} /> : <span className="sticker-placeholder" />}
      {showName ? <small>{sticker.name}</small> : null}
    </span>
  )
}
