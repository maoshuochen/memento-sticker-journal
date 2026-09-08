import { useEffect, useRef, useState, type CSSProperties } from "react"

import type { StickerFinish } from "@/domain/model"

type StickerForgeInstance = { destroy(): void }
type StickerForgeApi = {
  createSticker(element: HTMLElement, options: Record<string, unknown>): Promise<StickerForgeInstance>
}

declare global {
  interface Window {
    StickerForge?: StickerForgeApi
  }
}

let loader: Promise<void> | null = null

function loadStickerForge(): Promise<void> {
  if (window.StickerForge) return Promise.resolve()
  if (loader) return loader
  loader = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "/vendor/sticker-forge.iife.js"
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Sticker Forge failed to load."))
    document.head.append(script)
  })
  return loader
}

function options(source: string, finish: StickerFinish, edgeThickness: number): Record<string, unknown> {
  const lifted = finish === "edge-lift"
  // Sticker Forge renders this preview at a larger scale than the editor.
  // Keep the same setting relationship, but give the cut edge enough pixels
  // to read as a real white sticker border in the detail sheet.
  const previewOutlineWidth = Math.max(6, Math.round(edgeThickness * 2))
  return {
    // Keep a modest safety margin for the peel effect without surrounding the
    // sticker with so much transparent canvas that it looks undersized.
    source: { type: "image", src: source, padding: 42, textureMaxEdge: 1024 },
    outline: { width: previewOutlineWidth, color: "#fffdf7" },
    edge: { width: lifted ? 8 : 5, strength: 0.72 },
    shadow: { color: "#403731", opacity: 0.2, blur: lifted ? 4 : 3, distance: lifted ? 5 : 3, angle: 42 },
    peel: { radius: 0.13, stiffness: 0.72, grabWidth: 26, maxAngle: 3.2, release: "reset", residue: lifted, surfaceShadow: true },
    back: { color: "#f2eadf", gloss: 0.46, roughness: 0.45 },
    material: { type: "original", intensity: 0.28, scale: 1 },
    sound: { enabled: false, volume: 0 },
    tilt: -3,
    wind: 0.08,
    quality: "medium",
  }
}

export function PeelPreview({ source, finish, edgeThickness }: { source: string; finish: StickerFinish; edgeThickness: number }) {
  const host = useRef<HTMLDivElement>(null)
  const [hint, setHint] = useState("Grab the sticker edge and peel it up.")
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const element = host.current
    if (!element) return
    let active = true
    let instance: StickerForgeInstance | undefined
    void loadStickerForge()
      .then(async () => {
        if (!active || !window.StickerForge) return
        instance = await window.StickerForge.createSticker(element, options(source, finish, edgeThickness))
        if (!active) instance.destroy()
      })
      .catch(() => {
        if (active) {
          setFallback(true)
          setHint("Preview ready. This device does not support the peel effect.")
        }
      })
    const onStart = () => setHint("Keep pulling from the edge.")
    const onEnd = () => setHint("Nice. It settles back into your library.")
    element.addEventListener("peelstart", onStart, { once: true })
    element.addEventListener("peelend", onEnd, { once: true })
    return () => {
      active = false
      instance?.destroy()
      element.replaceChildren()
    }
  }, [edgeThickness, finish, source])

  return (
    <div className="peel-preview-wrap">
      <div ref={host} className="peel-preview-host">
        {fallback ? (
          <span className={`memento-sticker cutout ${finish} peel-preview-fallback`} style={{ "--edge": `${edgeThickness}px`, "--sticker-outline-filter": `url("#memento-sticker-outline-${Math.max(1, Math.min(10, Math.round(edgeThickness)))})` } as CSSProperties}>
            <img src={source} alt="Sticker preview" />
          </span>
        ) : null}
      </div>
      <p className="peel-hint">{hint}</p>
    </div>
  )
}
