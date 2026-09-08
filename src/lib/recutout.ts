import { compressImageForUpload } from "@/lib/images"

export type CropSelection = {
  x: number
  y: number
  width: number
  height: number
  angle: number
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

/** Keeps a rotated crop rectangle completely inside its source image. */
export function clampCropSelection(selection: CropSelection): CropSelection {
  let width = clamp(selection.width, 0.12, 1)
  let height = clamp(selection.height, 0.12, 1)
  const radians = selection.angle * Math.PI / 180
  const cosine = Math.abs(Math.cos(radians))
  const sine = Math.abs(Math.sin(radians))
  const requiredExtent = Math.max(cosine * width + sine * height, sine * width + cosine * height)
  // A rotated rectangle can have a bounding box larger than the original.
  // Reduce it before clamping its centre so the selection never jumps or
  // produces impossible min/max bounds near the image edge.
  if (requiredExtent > 1) {
    width /= requiredExtent
    height /= requiredExtent
  }
  const horizontalExtent = (cosine * width + sine * height) / 2
  const verticalExtent = (sine * width + cosine * height) / 2
  return {
    ...selection,
    width,
    height,
    x: clamp(selection.x, horizontalExtent, 1 - horizontalExtent),
    y: clamp(selection.y, verticalExtent, 1 - verticalExtent),
  }
}

function asJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法裁剪这张图片。")), "image/jpeg", 0.9)
  })
}

/**
 * Crops a rotated normalized rectangle on the client before it reaches the
 * segmentation API. This deliberately makes the selected subject the visual
 * centre of the submitted image without exposing a selection API server-side.
 */
export async function cropSelectionForCutout(source: Blob, selection: CropSelection): Promise<Blob> {
  const bounded = clampCropSelection(selection)
  const bitmap = await createImageBitmap(source)
  try {
    const outputWidth = Math.max(1, Math.round(bitmap.width * bounded.width))
    const outputHeight = Math.max(1, Math.round(bitmap.height * bounded.height))
    const canvas = document.createElement("canvas")
    canvas.width = outputWidth
    canvas.height = outputHeight
    const context = canvas.getContext("2d", { alpha: false })
    if (!context) throw new Error("浏览器无法处理这张图片。")
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, outputWidth, outputHeight)
    context.translate(outputWidth / 2, outputHeight / 2)
    context.rotate(-bounded.angle * Math.PI / 180)
    context.translate(-bitmap.width * bounded.x, -bitmap.height * bounded.y)
    context.drawImage(bitmap, 0, 0)
    return await compressImageForUpload(await asJpeg(canvas))
  } finally {
    bitmap.close()
  }
}
