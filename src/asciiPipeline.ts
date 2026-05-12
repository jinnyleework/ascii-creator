export type GrayscaleMode =
  | 'luminance'
  | 'average'
  | 'lightness'
  | 'red'
  | 'green'
  | 'blue'

export type AnimationMode =
  | 'solarize'
  | 'ramp'
  | 'hue'
  | 'sharpen'
  | 'edge'
  | 'glow'

export interface AsciiPipelineParams {
  columns: number
  charset: string
  rampInvert: boolean
  grayscaleMode: GrayscaleMode
  /** Invert luminance before other effects (Sabattier-style prep). */
  imageInvert: boolean
  solarizeEnabled: boolean
  solarizeThreshold: number
  blurPasses: number
  sharpenAmount: number
  edgeEmphasis: number
  useColor: boolean
  /** #rrggbb — glyph colour when not sampling per-pixel colour */
  grayscaleGlyphHex: string
  /** When useColor: HSL saturation multiplier (1 = unchanged, above 1 = more vivid). */
  colorSaturation: number
  /** 0–1, drives animation modes when animating */
  animationPhase: number
  animationMode: AnimationMode | null
}

export interface AsciiCell {
  ch: string
  /** #rrggbb for HTML / SVG */
  color: string
}

export interface AsciiResult {
  cols: number
  rows: number
  lines: AsciiCell[][]
  plainText: string
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/** 0 at phase 0, 1 at phase 0.5, 0 at phase 1 — smooth low → high → low. */
function animWave01(phase: number): number {
  return (1 - Math.cos(phase * Math.PI * 2)) / 2
}

function normalizeHex6(s: string): string | null {
  const m = s.trim().match(/^#?([0-9a-f]{6})$/i)
  return m ? `#${m[1]!.toLowerCase()}` : null
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

/** RGB 0–255 → adjusted RGB after scaling HSL saturation (mult 1 = no change). */
function adjustSaturation(
  r255: number,
  g255: number,
  b255: number,
  mult: number
): [number, number, number] {
  if (mult <= 0 || !Number.isFinite(mult)) return [r255, g255, b255]
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (Math.abs(max - min) < 1e-8) {
    return [clamp255(r255), clamp255(g255), clamp255(b255)]
  }
  const d = max - min
  const s =
    l > 0.5 ? d / (2 - max - min + 1e-12) : d / (max + min + 1e-12)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6

  const s2 = Math.max(0, Math.min(1, s * mult))

  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s2) : l + s2 - l * s2
  const p = 2 * l - q
  const R = hue2rgb(p, q, h + 1 / 3)
  const G = hue2rgb(p, q, h)
  const B = hue2rgb(p, q, h - 1 / 3)
  return [clamp255(R * 255), clamp255(G * 255), clamp255(B * 255)]
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) =>
        clamp255(x)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

function hueRotateRgb(r: number, g: number, b: number, deg: number): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const d = max - min
  let h = 0
  if (d > 1e-6) {
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6
    else if (max === G) h = ((B - R) / d + 2) / 6
    else h = ((R - G) / d + 4) / 6
  }
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1) + 1e-9)
  let nh = (h + deg / 360) % 1
  if (nh < 0) nh += 1

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((nh * 6) % 2 - 1))
  const m = l - c / 2
  let rp = 0,
    gp = 0,
    bp = 0
  const seg = Math.floor(nh * 6)
  switch (seg) {
    case 0:
      rp = c
      gp = x
      break
    case 1:
      rp = x
      gp = c
      break
    case 2:
      gp = c
      bp = x
      break
    case 3:
      gp = x
      bp = c
      break
    case 4:
      rp = x
      bp = c
      break
    default:
      rp = c
      bp = x
      break
  }
  return [clamp255((rp + m) * 255), clamp255((gp + m) * 255), clamp255((bp + m) * 255)]
}

function boxBlur(gray: Float32Array, cols: number, rows: number, r: number): Float32Array {
  if (r <= 0) return gray.slice()
  const out = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0
      let c = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ny = y + dy
          const nx = x + dx
          if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
            s += gray[ny * cols + nx]!
            c++
          }
        }
      }
      out[y * cols + x] = s / c
    }
  }
  return out
}

function sobelMax(gray: Float32Array, cols: number, rows: number): Float32Array {
  const mag = new Float32Array(cols * rows)
  let mx = 1e-6
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = (y - 1) * cols + (x - 1)
      const a = gray[i]!
      const b = gray[i + 1]!
      const c = gray[i + 2]!
      const d = gray[i + cols]!
      const f = gray[i + cols + 2]!
      const g0 = gray[i + 2 * cols]!
      const h = gray[i + 2 * cols + 1]!
      const br = gray[i + 2 * cols + 2]!
      const gx = -a + c - 2 * d + 2 * f - g0 + br
      const gy = -a - 2 * b - c + g0 + 2 * h + br
      const m = Math.sqrt(gx * gx + gy * gy)
      mag[y * cols + x] = m
      if (m > mx) mx = m
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
        mag[idx] = 0
      } else {
        mag[idx] = Math.min(255, (mag[idx]! / mx) * 255)
      }
    }
  }
  return mag
}

function getRamp(charset: string): string {
  const stripped = charset.replace(/\r?\n/g, '')
  if (stripped.length > 0) return stripped
  // Empty custom ramp: minimal two-step ramp until the user adds characters
  return ' .'
}

export function buildAscii(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  params: AsciiPipelineParams
): AsciiResult {
  const cols = Math.max(1, Math.floor(params.columns))
  const rows = Math.max(
    1,
    Math.round((cols * naturalHeight) / (2 * naturalWidth))
  )

  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return { cols, rows, lines: [], plainText: '' }
  }

  ctx.drawImage(source, 0, 0, cols, rows)
  const { data } = ctx.getImageData(0, 0, cols, rows)

  const n = cols * rows
  const gray = new Float32Array(n)
  const cr = new Float32Array(n)
  const cg = new Float32Array(n)
  const cb = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const o = i * 4
    let r = data[o]!
    let g = data[o + 1]!
    let b = data[o + 2]!
    const a = data[o + 3]! / 255
    r = r * a + 255 * (1 - a)
    g = g * a + 255 * (1 - a)
    b = b * a + 255 * (1 - a)
    cr[i] = r
    cg[i] = g
    cb[i] = b
    gray[i] = grayscaleFrom(r, g, b, params.grayscaleMode)
  }

  if (params.imageInvert) {
    for (let i = 0; i < n; i++) gray[i] = 255 - gray[i]!
  }

  let thr = params.solarizeThreshold
  if (params.animationMode === 'solarize' && params.solarizeEnabled) {
    thr = clamp255(thr + 70 * Math.sin(params.animationPhase * Math.PI * 2))
  }

  if (params.solarizeEnabled) {
    for (let i = 0; i < n; i++) {
      if (gray[i]! > thr) gray[i] = 255 - gray[i]!
    }
  }

  let passes = Math.max(0, Math.min(8, Math.round(params.blurPasses)))
  if (params.animationMode === 'glow') {
    passes = Math.round(8 * animWave01(params.animationPhase))
  }
  const r = passes > 0 ? 1 : 0
  for (let p = 0; p < passes; p++) {
    const blurred = boxBlur(gray, cols, rows, r)
    gray.set(blurred)
  }

  let edgeW = Math.max(0, Math.min(1, params.edgeEmphasis))
  if (params.animationMode === 'edge') {
    edgeW = animWave01(params.animationPhase)
  }
  if (edgeW > 0.001) {
    const edge = sobelMax(gray, cols, rows)
    const w = edgeW
    for (let i = 0; i < n; i++) {
      gray[i] = gray[i]! * (1 - w) + edge[i]! * w
    }
  }

  let sharp = Math.max(0, Math.min(3, params.sharpenAmount))
  if (params.animationMode === 'sharpen') {
    sharp = 3 * animWave01(params.animationPhase)
  }
  if (sharp > 0.001) {
    const soft = boxBlur(gray, cols, rows, 1)
    for (let i = 0; i < n; i++) {
      gray[i] = clamp255(gray[i]! + sharp * (gray[i]! - soft[i]!))
    }
  }

  const ramp = getRamp(params.charset)
  const maxIdx = Math.max(0, ramp.length - 1)
  let rampShift = 0
  if (params.animationMode === 'ramp' && maxIdx > 0) {
    rampShift = Math.floor(params.animationPhase * ramp.length) % ramp.length
  }

  const lines: AsciiCell[][] = []
  const textLines: string[] = []

  for (let y = 0; y < rows; y++) {
    const row: AsciiCell[] = []
    let line = ''
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      let lum = gray[i]! / 255
      let idx = maxIdx === 0 ? 0 : Math.floor((1 - lum) * maxIdx)
      if (params.rampInvert) idx = maxIdx - idx
      if (rampShift) idx = (idx + rampShift) % (maxIdx + 1)
      idx = Math.max(0, Math.min(maxIdx, idx))
      const ch = ramp[idx]!

      let R = cr[i]!
      let G = cg[i]!
      let B = cb[i]!
      if (params.useColor && params.animationMode === 'hue') {
        ;[R, G, B] = hueRotateRgb(R, G, B, params.animationPhase * 360)
      }

      if (
        params.useColor &&
        Number.isFinite(params.colorSaturation) &&
        Math.abs(params.colorSaturation - 1) > 1e-6
      ) {
        const m = Math.max(0, Math.min(4, params.colorSaturation))
        ;[R, G, B] = adjustSaturation(R, G, B, m)
      }

      const color = params.useColor
        ? rgbToHex(R, G, B)
        : (normalizeHex6(params.grayscaleGlyphHex) ?? '#0a0a0a')
      row.push({ ch, color })
      line += ch
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

export interface SvgExportOptions {
  fontSize: number
  lineHeight: number
  /** Approximate monospace advance in em */
  charAdvanceEm: number
  background: string
  animated: boolean
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface SvgOverlayExportOptions {
  /** Pre-rendered image data URL (already grayscaled at source if requested). */
  imageDataUrl: string
  width: number
  height: number
  useColor: boolean
  grayscaleGlyphColor: string
  /** Faint dark outline around glyphs for legibility (matches viewfinder text-shadow). */
  glyphOutline?: string
}

/** Mirrors the in-app AsciiImageOverlay: image bottom layer, per-cell centred glyphs on top. */
export function asciiOverlayToSvg(
  result: AsciiResult,
  opts: SvgOverlayExportOptions
): string {
  const {
    imageDataUrl,
    width: bw,
    height: bh,
    useColor,
    grayscaleGlyphColor,
    glyphOutline = 'rgba(0,0,0,0.35)',
  } = opts

  const cellW = bw / result.cols
  const cellH = bh / result.rows
  const fontSize = Math.max(2, Math.min(cellW / 0.62, cellH * 0.92))
  const strokeWidth = Math.max(0.5, fontSize * 0.06)

  const glyphs: string[] = []
  for (let yi = 0; yi < result.lines.length; yi++) {
    const row = result.lines[yi]!
    const cy = (yi + 0.5) * cellH
    for (let xi = 0; xi < row.length; xi++) {
      const cell = row[xi]!
      const cx = (xi + 0.5) * cellW
      const color = useColor ? cell.color : grayscaleGlyphColor
      glyphs.push(
        `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" fill="${escapeXml(color)}" stroke="${escapeXml(glyphOutline)}" stroke-width="${strokeWidth.toFixed(2)}" paint-order="stroke fill" text-anchor="middle" dominant-baseline="central" font-family="'Geist Mono', ui-monospace, Consolas, monospace" font-size="${fontSize.toFixed(2)}" font-weight="500">${escapeXml(cell.ch)}</text>`
      )
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}">
<image href="${imageDataUrl}" x="0" y="0" width="${bw}" height="${bh}" preserveAspectRatio="none"/>
${glyphs.join('\n')}
</svg>`
}

export function asciiResultToSvg(result: AsciiResult, opts: SvgExportOptions): string {
  const { fontSize, lineHeight, charAdvanceEm, background, animated } = opts
  const charW = fontSize * charAdvanceEm
  const pad = 8
  const w = pad * 2 + result.cols * charW
  const h = pad * 2 + result.rows * lineHeight

  const styleId = 'asciiAnim'
  const keyframesCss = animated
    ? `@keyframes ${styleId}Hue { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); } }
@keyframes ${styleId}Pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.82; } }`
    : ''

  const groupClass = animated ? ` class="ascii-root"` : ''
  const groupStyle = animated
    ? ` style="animation: ${styleId}Hue 10s linear infinite, ${styleId}Pulse 3.2s ease-in-out infinite; transform-origin: ${pad}px ${pad}px;"`
    : ''

  const textBlocks: string[] = []
  for (let li = 0; li < result.lines.length; li++) {
    const row = result.lines[li]!
    const y = pad + (li + 1) * lineHeight
    const tspans = row
      .map((cell) => `<tspan fill="${escapeXml(cell.color)}">${escapeXml(cell.ch)}</tspan>`)
      .join('')
    textBlocks.push(
      `<text x="${pad}" y="${y.toFixed(2)}" font-family="'Geist Mono', ui-monospace, Consolas, monospace" font-size="${fontSize}" xml:space="preserve">${tspans}</text>`
    )
  }

  const defs = keyframesCss
    ? `<defs><style type="text/css"><![CDATA[
${keyframesCss}
]]></style></defs>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}">
${defs}
<rect width="100%" height="100%" fill="${escapeXml(background)}"/>
<g${groupClass}${groupStyle}>
${textBlocks.join('\n')}
</g>
</svg>`
}
