const MAX_UPLOAD_BYTES = 3 * 1024 * 1024
const MAX_IMAGE_EDGE = 1800

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("无法压缩这张图片。")),
      "image/jpeg",
      quality,
    )
  })
}

export async function compressImageForUpload(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
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

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
