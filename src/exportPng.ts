import type { AsciiResult } from './asciiPipeline'

export interface PngExportOptions {
  background: string
  /** Base font size in CSS pixels before device scaling. */
  fontSize: number
  /** Sharpness multiplier (2 = double internal resolution). */
  pixelRatio: number
}

export interface OverlayPngExportOptions {
  bitmap: ImageBitmap
  useColor: boolean
  grayscaleGlyphColor: string
  photoGrayscale: boolean
  /** Sharpness multiplier (2 = double internal resolution). */
  pixelRatio: number
}

/** Mirrors the AsciiImageOverlay viewfinder (image + per-cell centred glyphs with a faint outline). */
export function asciiOverlayToPngBlob(
  result: AsciiResult,
  opts: OverlayPngExportOptions
): Promise<Blob | null> {
  const { bitmap, useColor, grayscaleGlyphColor, photoGrayscale, pixelRatio } = opts
  if (result.cols <= 0 || result.rows <= 0) return Promise.resolve(null)

  const bw = bitmap.width
  const bh = bitmap.height
  const w = Math.round(bw * pixelRatio)
  const h = Math.round(bh * pixelRatio)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)

  if (photoGrayscale) {
    ctx.filter = 'grayscale(1) contrast(1.06)'
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  ctx.filter = 'none'

  const cellW = w / result.cols
  const cellH = h / result.rows
  const fontPx = Math.max(2, Math.min(cellW / 0.62, cellH * 0.92))
  const fontFamily =
    '"Geist Mono", ui-monospace, Consolas, "Cascadia Code", "SF Mono", Menlo, monospace'

  ctx.font = `500 ${fontPx}px ${fontFamily}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
  ctx.shadowBlur = Math.max(1, 3 * pixelRatio)

  for (let yi = 0; yi < result.rows; yi++) {
    const row = result.lines[yi]
    if (!row) continue
    const cy = (yi + 0.5) * cellH
    for (let xi = 0; xi < row.length; xi++) {
      const cell = row[xi]!
      const cx = (xi + 0.5) * cellW
      ctx.fillStyle = useColor ? cell.color : grayscaleGlyphColor
      ctx.fillText(cell.ch, cx, cy)
    }
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

export function bitmapToPngDataUrl(
  bitmap: ImageBitmap,
  photoGrayscale: boolean
): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (photoGrayscale) {
    ctx.filter = 'grayscale(1) contrast(1.06)'
  }
  ctx.drawImage(bitmap, 0, 0)
  return canvas.toDataURL('image/png')
}

export function asciiResultToPngBlob(
  result: AsciiResult,
  opts: PngExportOptions
): Promise<Blob | null> {
  const { background, fontSize, pixelRatio } = opts
  const rows = result.lines.length
  if (result.cols <= 0 || rows <= 0) return Promise.resolve(null)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)

  const pad = Math.round(12 * pixelRatio)
  const fontPx = Math.max(4, Math.round(fontSize * pixelRatio))
  const fontFamily =
    '"Geist Mono", ui-monospace, Consolas, "Cascadia Code", "SF Mono", Menlo, monospace'

  ctx.font = `${fontPx}px ${fontFamily}`
  const cw = Math.max(
    ctx.measureText('M').width,
    ctx.measureText('@').width,
    ctx.measureText('█').width
  )
  const lineHeight = fontPx * 1.22

  const w = Math.ceil(pad * 2 + result.cols * cw)
  const h = Math.ceil(pad * 2 + rows * lineHeight)

  canvas.width = w
  canvas.height = h

  ctx.font = `${fontPx}px ${fontFamily}`
  ctx.fillStyle = background
  ctx.fillRect(0, 0, w, h)
  ctx.textBaseline = 'top'

  for (let row = 0; row < rows; row++) {
    const line = result.lines[row]!
    let x = pad
    const y = pad + row * lineHeight
    for (let col = 0; col < line.length; col++) {
      const cell = line[col]!
      ctx.fillStyle = cell.color
      ctx.fillText(cell.ch, x, y)
      x += cw
    }
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}
