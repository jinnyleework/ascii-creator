import type { GrayscaleMode } from './asciiPipeline'

export type DitherMode = 'none' | 'floyd' | 'bayer4'

export interface EightBitParams {
  columns: number
  grayscaleMode: GrayscaleMode
  imageInvert: boolean
  solarizeEnabled: boolean
  solarizeThreshold: number
  blurPasses: number
  sharpenAmount: number
  edgeEmphasis: number
  useColor: boolean
  colorSaturationPct: number
  paletteSize: number
  dither: DitherMode
  animationPhase: number
  animHueEnabled: boolean
  /**
   * #rrggbb — RGBA transparent pixels composite onto this before quantisation
   * (matches preview stage so remove-background alpha does not read as white).
   */
  alphaMatteHex?: string
}

export interface EightBitResult {
  cols: number
  rows: number
  imageData: ImageData
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function normalizeHex6Matte(s: string): string | null {
  const m = s.trim().match(/^#?([0-9a-f]{6})$/i)
  return m ? `#${m[1]!.toLowerCase()}` : null
}

function alphaMatteRgb255(hex: string | undefined): [number, number, number] {
  const n = hex ? normalizeHex6Matte(hex) : null
  if (!n) return [255, 255, 255]
  const v = parseInt(n.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** Source alpha at or below this → fully transparent output (removed background). */
const OUTPUT_ALPHA_TRANSPARENT_EPS = 0.045

function outputAlphaByte(alphaOrig: number): 0 | 255 {
  return alphaOrig <= OUTPUT_ALPHA_TRANSPARENT_EPS ? 0 : 255
}

function grayscaleFrom(
  r: number,
  g: number,
  b: number,
  mode: GrayscaleMode
): number {
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

function hueRotateRgb(
  r: number,
  g: number,
  b: number,
  deg: number
): [number, number, number] {
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

type Rgb = [number, number, number]

function colorDist2(a: Rgb, b: Rgb): number {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return dr * dr + dg * dg + db * db
}

function nearestPalette(p: Rgb, palette: Rgb[]): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < palette.length; i++) {
    const d = colorDist2(p, palette[i]!)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Weighted median cut on RGB triples (each row is one pixel sample). */
function medianCutPalette(samples: Rgb[], maxColors: number): Rgb[] {
  const k = Math.max(2, Math.min(256, Math.floor(maxColors)))
  if (samples.length === 0) return [
    [0, 0, 0],
    [255, 255, 255],
  ]

  type Box = { pts: Rgb[] }
  const boxes: Box[] = [{ pts: samples.slice() }]
  let guard = 0

  while (boxes.length < k && guard++ < k * 4) {
    let bi = -1
    let bestScore = -1
    for (let i = 0; i < boxes.length; i++) {
      const pts = boxes[i]!.pts
      if (pts.length < 2) continue
      let r0 = 255,
        r1 = 0,
        g0 = 255,
        g1 = 0,
        b0 = 255,
        b1 = 0
      for (const p of pts) {
        r0 = Math.min(r0, p[0])
        r1 = Math.max(r1, p[0])
        g0 = Math.min(g0, p[1])
        g1 = Math.max(g1, p[1])
        b0 = Math.min(b0, p[2])
        b1 = Math.max(b1, p[2])
      }
      const span = Math.max(r1 - r0, g1 - g0, b1 - b0)
      const score = span * pts.length
      if (score > bestScore) {
        bestScore = score
        bi = i
      }
    }
    if (bi < 0) break

    const box = boxes[bi]!
    const pts = box.pts
    let r0 = 255,
      r1 = 0,
      g0 = 255,
      g1 = 0,
      b0 = 255,
      b1 = 0
    for (const p of pts) {
      r0 = Math.min(r0, p[0])
      r1 = Math.max(r1, p[0])
      g0 = Math.min(g0, p[1])
      g1 = Math.max(g1, p[1])
      b0 = Math.min(b0, p[2])
      b1 = Math.max(b1, p[2])
    }
    const dr = r1 - r0
    const dg = g1 - g0
    const db = b1 - b0
    let axis: 0 | 1 | 2 = 0
    if (dg >= dr && dg >= db) axis = 1
    else if (db >= dr && db >= dg) axis = 2

    const sorted = pts.slice().sort((a, b) => a[axis]! - b[axis]!)
    const mid = Math.max(1, Math.floor(sorted.length / 2))
    const left = sorted.slice(0, mid)
    const right = sorted.slice(mid)
    if (left.length === 0 || right.length === 0) break
    boxes.splice(bi, 1, { pts: left }, { pts: right })
  }

  const palette: Rgb[] = []
  for (const b of boxes) {
    if (b.pts.length === 0) continue
    let sr = 0,
      sg = 0,
      sb = 0
    for (const p of b.pts) {
      sr += p[0]
      sg += p[1]
      sb += p[2]
    }
    const n = b.pts.length
    palette.push([clamp255(sr / n), clamp255(sg / n), clamp255(sb / n)])
  }
  while (palette.length < k && palette.length < 256) {
    const last = palette[palette.length - 1]!
    palette.push([clamp255(last[0] ^ 8), clamp255(last[1] ^ 8), clamp255(last[2] ^ 8)])
  }
  return palette.slice(0, k)
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

export function buildEightBit(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  params: EightBitParams
): EightBitResult {
  const cols = Math.max(1, Math.floor(params.columns))
  /** Square pixels: preserve image aspect (ASCII uses /2 for monospace cell shape). */
  const rows = Math.max(
    1,
    Math.round((cols * naturalHeight) / naturalWidth)
  )

  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    const empty = new ImageData(cols, rows)
    return { cols, rows, imageData: empty }
  }

  ctx.drawImage(source, 0, 0, cols, rows)
  const { data } = ctx.getImageData(0, 0, cols, rows)

  const n = cols * rows
  const r0 = new Float32Array(n)
  const g0 = new Float32Array(n)
  const b0 = new Float32Array(n)
  const gray = new Float32Array(n)
  const alphaOrig = new Float32Array(n)
  const [mr, mg, mb] = alphaMatteRgb255(params.alphaMatteHex)

  for (let i = 0; i < n; i++) {
    const o = i * 4
    let r = data[o]!
    let g = data[o + 1]!
    let b = data[o + 2]!
    const a = data[o + 3]! / 255
    alphaOrig[i] = a
    r = r * a + mr * (1 - a)
    g = g * a + mg * (1 - a)
    b = b * a + mb * (1 - a)
    r0[i] = r
    g0[i] = g
    b0[i] = b
    gray[i] = grayscaleFrom(r, g, b, params.grayscaleMode)
  }

  let rr = new Float32Array(n)
  let gg = new Float32Array(n)
  let bb = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    rr[i] = r0[i]!
    gg[i] = g0[i]!
    bb[i] = b0[i]!
  }

  if (params.animHueEnabled) {
    for (let i = 0; i < n; i++) {
      const [R, G, B] = hueRotateRgb(rr[i]!, gg[i]!, bb[i]!, params.animationPhase * 360)
      rr[i] = R
      gg[i] = G
      bb[i] = B
    }
  }

  let gLine = Float32Array.from(gray)
  if (params.imageInvert) {
    for (let i = 0; i < n; i++) gLine[i] = 255 - gLine[i]!
  }

  let thr = params.solarizeThreshold
  if (params.solarizeEnabled) {
    for (let i = 0; i < n; i++) {
      if (gLine[i]! > thr) gLine[i] = 255 - gLine[i]!
    }
  }

  let passes = Math.max(0, Math.min(8, Math.round(params.blurPasses)))
  const rBlur = passes > 0 ? 1 : 0
  for (let p = 0; p < passes; p++) {
    const blurred = boxBlur(gLine, cols, rows, rBlur)
    gLine.set(blurred)
  }

  let edgeW = Math.max(0, Math.min(1, params.edgeEmphasis))
  if (edgeW > 0.001) {
    const edge = sobelMax(gLine, cols, rows)
    const w = edgeW
    for (let i = 0; i < n; i++) {
      gLine[i] = gLine[i]! * (1 - w) + edge[i]! * w
    }
  }

  let sharp = Math.max(0, Math.min(3, params.sharpenAmount))
  if (sharp > 0.001) {
    const soft = boxBlur(gLine, cols, rows, 1)
    for (let i = 0; i < n; i++) {
      gLine[i] = clamp255(gLine[i]! + sharp * (gLine[i]! - soft[i]!))
    }
  }

  const rf = new Float32Array(n)
  const gf = new Float32Array(n)
  const bf = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const gOrig = gray[i]!
    const gNew = gLine[i]!
    if (params.useColor) {
      const scale = gOrig > 1e-3 ? gNew / gOrig : 1
      const sc = Math.max(0.15, Math.min(3.5, scale))
      rf[i] = clamp255(rr[i]! * sc)
      gf[i] = clamp255(gg[i]! * sc)
      bf[i] = clamp255(bb[i]! * sc)
    } else {
      rf[i] = gNew
      gf[i] = gNew
      bf[i] = gNew
    }
  }

  if (params.useColor) {
    const m = Math.max(0, Math.min(4, params.colorSaturationPct / 100))
    if (Math.abs(m - 1) > 1e-6) {
      for (let i = 0; i < n; i++) {
        const [R, G, B] = adjustSaturation(rf[i]!, gf[i]!, bf[i]!, m)
        rf[i] = R
        gf[i] = G
        bf[i] = B
      }
    }
  }

  const stride = Math.max(1, Math.floor(n / 12000))
  const samples: Rgb[] = []
  for (let i = 0; i < n; i += stride) {
    samples.push([rf[i]!, gf[i]!, bf[i]!])
  }
  const palette = medianCutPalette(samples, params.paletteSize)

  const out = ctx.createImageData(cols, rows)
  const od = out.data

  if (params.dither === 'floyd') {
    const fr = new Float32Array(n)
    const fg = new Float32Array(n)
    const fb = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      fr[i] = rf[i]!
      fg[i] = gf[i]!
      fb[i] = bf[i]!
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        let r = fr[i]!
        let g = fg[i]!
        let b = fb[i]!
        r = clamp255(r)
        g = clamp255(g)
        b = clamp255(b)
        const pi = nearestPalette([r, g, b], palette)
        const pr = palette[pi]![0]
        const pg = palette[pi]![1]
        const pb = palette[pi]![2]
        const er = r - pr
        const eg = g - pg
        const eb = b - pb
        const o = i * 4
        if (outputAlphaByte(alphaOrig[i]!) === 0) {
          od[o] = 0
          od[o + 1] = 0
          od[o + 2] = 0
          od[o + 3] = 0
        } else {
          od[o] = pr
          od[o + 1] = pg
          od[o + 2] = pb
          od[o + 3] = 255
        }
        const spread = (dx: number, dy: number, f: number) => {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return
          const j = ny * cols + nx
          fr[j] += er * f
          fg[j] += eg * f
          fb[j] += eb * f
        }
        spread(1, 0, 7 / 16)
        spread(-1, 1, 3 / 16)
        spread(0, 1, 5 / 16)
        spread(1, 1, 1 / 16)
      }
    }
  } else if (params.dither === 'bayer4') {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        const t = (BAYER4[y & 3]![x & 3]! - 7.5) / 16
        const strength = 18
        let r = rf[i]! + t * strength
        let g = gf[i]! + t * strength
        let b = bf[i]! + t * strength
        r = clamp255(r)
        g = clamp255(g)
        b = clamp255(b)
        const pi = nearestPalette([r, g, b], palette)
        const pr = palette[pi]![0]
        const pg = palette[pi]![1]
        const pb = palette[pi]![2]
        const o = i * 4
        if (outputAlphaByte(alphaOrig[i]!) === 0) {
          od[o] = 0
          od[o + 1] = 0
          od[o + 2] = 0
          od[o + 3] = 0
        } else {
          od[o] = pr
          od[o + 1] = pg
          od[o + 2] = pb
          od[o + 3] = 255
        }
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      const pi = nearestPalette([rf[i]!, gf[i]!, bf[i]!], palette)
      const pr = palette[pi]![0]
      const pg = palette[pi]![1]
      const pb = palette[pi]![2]
      const o = i * 4
      if (outputAlphaByte(alphaOrig[i]!) === 0) {
        od[o] = 0
        od[o + 1] = 0
        od[o + 2] = 0
        od[o + 3] = 0
      } else {
        od[o] = pr
        od[o + 1] = pg
        od[o + 2] = pb
        od[o + 3] = 255
      }
    }
  }

  return { cols, rows, imageData: out }
}

export function eightBitToPngBlob(
  result: EightBitResult,
  opts: { scale: number; background: string; pixelRatio: number }
): Promise<Blob | null> {
  const { cols, rows } = result
  const scale = Math.max(1, Math.min(32, opts.scale))
  const pr = Math.max(1, Math.min(4, opts.pixelRatio))
  const w = Math.round(cols * scale * pr)
  const h = Math.round(rows * scale * pr)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)

  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = opts.background
  ctx.fillRect(0, 0, w, h)

  const tmp = document.createElement('canvas')
  tmp.width = cols
  tmp.height = rows
  const tctx = tmp.getContext('2d')
  if (!tctx) return Promise.resolve(null)
  tctx.putImageData(result.imageData, 0, 0)

  ctx.save()
  ctx.scale(pr, pr)
  ctx.drawImage(tmp, 0, 0, cols, rows, 0, 0, cols * scale, rows * scale)
  ctx.restore()

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}
