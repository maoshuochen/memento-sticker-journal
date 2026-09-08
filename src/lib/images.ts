const MAX_UPLOAD_BYTES = 3 * 1024 * 1024
const MAX_IMAGE_EDGE = 1800

export function isSupportedUploadImage(file: Pick<Blob, "type">): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type)
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("无法压缩这张图片。")),
      "image/jpeg",
      quality,
    )
  })
}

export async function compressImageForUpload(file: Blob): Promise<Blob> {
  if (!isSupportedUploadImage(file)) {
    throw new Error("请选择 JPEG、PNG 或 WebP 图片。")
  }
  const bitmap = await createImageBitmap(file)
  let scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
  let quality = 0.88

  try {
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext("2d", { alpha: false })
      if (!context) throw new Error("浏览器无法处理这张图片。")
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await canvasToBlob(canvas, quality)
      if (blob.size <= MAX_UPLOAD_BYTES) return blob
      scale *= 0.82
      quality = Math.max(0.58, quality - 0.08)
    }
  } finally {
    bitmap.close()
  }
  throw new Error("压缩后仍超过 3 MiB，请换一张较小的图片。")
}

/** Keeps cutout transparency while avoiding CPU-heavy Worker-side conversion. */
export async function optimizeStickerStorage(source: Blob): Promise<Blob> {
  if (source.type !== "image/png" || source.size === 0) return source
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext("2d")
    if (!context) return source
    context.drawImage(bitmap, 0, 0)
    const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82))
    // Unsupported encoders can silently return PNG. Retain PNG unless WebP saves 10%.
    return webp?.type === "image/webp" && webp.size <= source.size * 0.9 ? webp : source
  } finally {
    bitmap.close()
  }
}

/** Converts bundled SVG stickers to a format accepted by the vision model. */
export async function prepareStickerForRecognition(source: Blob): Promise<Blob> {
  if (["image/jpeg", "image/png", "image/webp"].includes(source.type)) return source
  if (source.type !== "image/svg+xml") throw new Error("这张贴纸的图片格式暂不支持 AI 识别。")

  const bitmap = await createImageBitmap(source)
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("浏览器无法处理这张贴纸。")
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("无法转换这张贴纸。")),
      "image/png",
    ))
  } finally {
    bitmap.close()
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  // Mobile Chromium is less forgiving than desktop when a detached anchor is
  // clicked after async canvas work. Keep it in the document until the
  // download has started, and do not revoke its object URL in the same task.
  anchor.style.display = "none"
  document.body.append(anchor)
  anchor.click()
  window.setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 1_500)
}
