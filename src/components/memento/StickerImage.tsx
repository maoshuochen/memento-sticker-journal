import type { CSSProperties } from "react"

import { useAppData } from "@/app/AppDataProvider"
import type { StickerRecord } from "@/domain/model"
import { cn } from "@/lib/utils"

const bundledStickerPrefix = "/assets/stickers/"
const bundledStickerVersion = "twemoji-14.0.2"

export function versionBundledStickerSource(source: string | undefined): string | undefined {
  if (!source?.startsWith(bundledStickerPrefix) || source.includes("?")) return source
  return `${source}?v=${bundledStickerVersion}`
}

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
  const source = versionBundledStickerSource(assetUrls.get(sticker.assetId))
  const isBundledSticker = source?.startsWith(bundledStickerPrefix)
  const outlineWidth = Math.max(1, Math.min(10, Math.round(sticker.edgeThickness)))

  return (
    <span
      className={cn("memento-sticker", "cutout", !isBundledSticker && "uploaded-sticker", sticker.border, sticker.finish, className)}
      style={{
        "--sticker-tilt": `${sticker.tilt}deg`,
        "--edge": `${outlineWidth}px`,
        "--sticker-outline-filter": `url("#memento-sticker-outline-${outlineWidth}")`,
        ...style,
      } as CSSProperties}
    >
      {source ? <img src={source} alt="" draggable={false} /> : <span className="sticker-placeholder" />}
      {showName ? <small>{sticker.name}</small> : null}
    </span>
  )
}
