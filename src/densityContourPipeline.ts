import type { AsciiCell, AsciiResult, GrayscaleMode } from './asciiPipeline'

/** Shared corner grid + iso levels for ASCII preview and vector contour lines */
export type DensityCornerField = {
  cols: number
  rows: number
  cw: number
  ch: number
  gray: Float32Array
  cr: Float32Array
  cg: Float32Array
  cb: Float32Array
  levels: number[]
  mr: number
  mg: number
  mb: number
}

export interface DensityContourParams {
  columns: number
  grayscaleMode: GrayscaleMode
  imageInvert: boolean
  /** 0–8 box blur passes on the corner density field */
  blurPasses: number
  /** Number of evenly spaced iso levels between min and max density */
  contourLevels: number
  /** #rrggbb — contour line colour */
  contourHex: string
  /** Character ramp for density fill (darkest → lightest by convention: high density = dark start) */
  charset: string
  /** When true, ramp maps from sampled colour; contour colour still applies on top */
  useColor: boolean
  /** #rrggbb — matte behind transparent pixels */
  alphaMatteHex?: string
  /** When true, draw only contour glyphs (spaces elsewhere); else density fill under contours */
  contoursOnly: boolean
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function normalizeHex6(s: string): string | null {
  const m = s.trim().match(/^#?([0-9a-f]{6})$/i)
  return m ? `#${m[1]!.toLowerCase()}` : null
}

function alphaMatteRgb255(hex: string | undefined): [number, number, number] {
  const n = hex ? normalizeHex6(hex) : null
  if (!n) return [255, 255, 255]
  const v = parseInt(n.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function grayscaleFrom(r: number, g: number, b: number, mode: GrayscaleMode): number {
  switch (mode) {
    case 'luminance':
      return 0.299 * r + 0.587 * g + 0.114 * b
    case 'average':
      return (r + g + b) / 3
    case 'lightness': {
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      return (mx + mn) / 2
    }
    case 'red':
      return r
    case 'green':
      return g
    case 'blue':
      return b
    default:
      return 0.299 * r + 0.587 * g + 0.114 * b
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((x) =>
      clamp255(x)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

function boxBlurCorners(
  g: Float32Array,
  w: number,
  h: number,
  r: number
): Float32Array {
  if (r <= 0) return g.slice()
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      let c = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ny = y + dy
          const nx = x + dx
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
            s += g[ny * w + nx]!
            c++
          }
        }
      }
      out[y * w + x] = s / c
    }
  }
  return out
}

function getRamp(charset: string): string {
  const stripped = charset.replace(/\r?\n/g, '')
  if (stripped.length > 0) return stripped
  return ' .:-=+*#%@'
}

/**
 * Samples corner density + iso levels (shared with vector contour renderer).
 */
export function sampleDensityCornerField(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  params: Pick<
    DensityContourParams,
    'columns' | 'grayscaleMode' | 'imageInvert' | 'blurPasses' | 'contourLevels' | 'alphaMatteHex'
  >
): DensityCornerField | null {
  const cols = Math.max(1, Math.floor(params.columns))
  const rows = Math.max(
    1,
    Math.round((cols * naturalHeight) / (2 * naturalWidth))
  )

  const cw = cols + 1
  const ch = rows + 1
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(source, 0, 0, cw, ch)
  const { data } = ctx.getImageData(0, 0, cw, ch)
  const [mr, mg, mb] = alphaMatteRgb255(params.alphaMatteHex)
  const nCorners = cw * ch
  const gray = new Float32Array(nCorners)
  const cr = new Float32Array(nCorners)
  const cg = new Float32Array(nCorners)
  const cb = new Float32Array(nCorners)

  for (let i = 0; i < nCorners; i++) {
    const o = i * 4
    let r = data[o]!
    let g = data[o + 1]!
    let b = data[o + 2]!
    const a = data[o + 3]! / 255
    r = r * a + mr * (1 - a)
    g = g * a + mg * (1 - a)
    b = b * a + mb * (1 - a)
    cr[i] = r
    cg[i] = g
    cb[i] = b
    gray[i] = grayscaleFrom(r, g, b, params.grayscaleMode)
  }

  if (params.imageInvert) {
    for (let i = 0; i < nCorners; i++) gray[i] = 255 - gray[i]!
  }

  const passes = Math.max(0, Math.min(8, Math.round(params.blurPasses)))
  const br = passes > 0 ? 1 : 0
  for (let p = 0; p < passes; p++) {
    const blurred = boxBlurCorners(gray, cw, ch, br)
    gray.set(blurred)
  }

  let gmin = 255
  let gmax = 0
  for (let i = 0; i < nCorners; i++) {
    const v = gray[i]!
    if (v < gmin) gmin = v
    if (v > gmax) gmax = v
  }
  if (gmax <= gmin) gmax = gmin + 1e-6

  const nLevels = Math.max(1, Math.min(24, Math.round(params.contourLevels)))
  const levels: number[] = []
  for (let i = 0; i < nLevels; i++) {
    const t = (i + 1) / (nLevels + 1)
    levels.push(gmin + t * (gmax - gmin))
  }

  return {
    cols,
    rows,
    cw,
    ch,
    gray,
    cr,
    cg,
    cb,
    levels,
    mr,
    mg,
    mb,
  }
}

/**
 * Edge flags: top, right, bottom, left — each true if TL/TR/BR/BL straddle iso across that edge.
 * Maps to light box-drawing glyphs (single-cell topology).
 */
function edgePatternGlyph(t: boolean, r: boolean, b: boolean, l: boolean): string {
  const idx = (t ? 8 : 0) | (r ? 4 : 0) | (b ? 2 : 0) | (l ? 1 : 0)
  switch (idx) {
    case 0b0000:
      return ''
    case 0b1010:
      return '│'
    case 0b0101:
      return '─'
    case 0b1100:
      return '┐'
    case 0b0110:
      return '┘'
    case 0b0011:
      return '└'
    case 0b1001:
      return '┌'
    case 0b1111:
      return '┼'
    case 0b1110:
      return '┬'
    case 0b0111:
      return '┤'
    case 0b1011:
      return '├'
    case 0b1101:
      return '┴'
    default:
      return '+'
  }
}

export function buildDensityContoursFromField(
  field: DensityCornerField,
  params: Pick<
    DensityContourParams,
    'charset' | 'useColor' | 'contourHex' | 'contoursOnly'
  >
): AsciiResult {
  const { cols, rows, cw, gray, cr, cg, cb, levels, mr, mg, mb } = field

  const contourN = normalizeHex6(params.contourHex) ?? '#0a0a0a'
  const fillContourRgb = [
    parseInt(contourN.slice(1, 3), 16),
    parseInt(contourN.slice(3, 5), 16),
    parseInt(contourN.slice(5, 7), 16),
  ] as const

  const ramp = getRamp(params.charset)
  const maxIdx = Math.max(0, ramp.length - 1)

  const lines: AsciiCell[][] = []
  const textLines: string[] = []

  const corner = (x: number, y: number) => gray[y * cw + x]!

  for (let y = 0; y < rows; y++) {
    const row: AsciiCell[] = []
    let line = ''
    for (let x = 0; x < cols; x++) {
      const tl = corner(x, y)
      const tr = corner(x + 1, y)
      const br = corner(x + 1, y + 1)
      const bl = corner(x, y + 1)

      const cx = (tl + tr + br + bl) / 4
      const i00 = y * cw + x
      const i10 = y * cw + x + 1
      const i11 = (y + 1) * cw + x + 1
      const i01 = (y + 1) * cw + x

      let tAny = false
      let rAny = false
      let bAny = false
      let lAny = false
      for (const iso of levels) {
        tAny ||= tl >= iso !== tr >= iso
        rAny ||= tr >= iso !== br >= iso
        bAny ||= br >= iso !== bl >= iso
        lAny ||= bl >= iso !== tl >= iso
      }
      const contourGlyph = edgePatternGlyph(tAny, rAny, bAny, lAny)

      let fillCh: string
      let fillColor: string
      if (params.contoursOnly) {
        fillCh = ' '
        fillColor = rgbToHex(mr, mg, mb)
      } else {
        const lum = cx / 255
        let idx = maxIdx === 0 ? 0 : Math.floor((1 - lum) * maxIdx)
        idx = Math.max(0, Math.min(maxIdx, idx))
        fillCh = ramp[idx]!
        if (params.useColor) {
          const sr = (cr[i00]! + cr[i10]! + cr[i11]! + cr[i01]!) / 4
          const sg = (cg[i00]! + cg[i10]! + cg[i11]! + cg[i01]!) / 4
          const sb = (cb[i00]! + cb[i10]! + cb[i11]! + cb[i01]!) / 4
          fillColor = rgbToHex(sr, sg, sb)
        } else {
          const v = clamp255(cx)
          fillColor = rgbToHex(v, v, v)
        }
      }

      if (contourGlyph) {
        row.push({
          ch: contourGlyph,
          color: `rgb(${fillContourRgb[0]},${fillContourRgb[1]},${fillContourRgb[2]})`,
        })
        line += contourGlyph
      } else {
        row.push({ ch: fillCh, color: fillColor })
        line += fillCh
      }
    }
    lines.push(row)
    textLines.push(line)
  }

  return {
    cols,
    rows,
    lines,
    plainText: textLines.join('\n'),
  }
}

export function buildDensityContours(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  params: DensityContourParams
): AsciiResult {
  const field = sampleDensityCornerField(source, naturalWidth, naturalHeight, params)
  if (!field) {
    return { cols: 0, rows: 0, lines: [], plainText: '' }
  }
  return buildDensityContoursFromField(field, params)
}
