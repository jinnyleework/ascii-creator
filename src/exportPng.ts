import type { AsciiResult } from './asciiPipeline'

export interface PngExportOptions {
  background: string
  /** Base font size in CSS pixels before device scaling. */
  fontSize: number
  /** Sharpness multiplier (2 = double internal resolution). */
  pixelRatio: number
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
