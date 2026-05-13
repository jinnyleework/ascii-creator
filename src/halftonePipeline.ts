import type { GrayscaleMode } from './asciiPipeline'

const OUTPUT_ALPHA_TRANSPARENT_EPS = 0.045

/** Single ink / sampled colour vs multiply-stacked riso-style ink layers. */
export type HalftoneDotModel = 'single' | 'layered'

export interface HalftoneParams {
  columns: number
  dotModel: HalftoneDotModel
  /** Pixels along each cell edge in the output bitmap (quality / smooth dots). */
  pixelsPerCell: number
  /** 0–1 fraction of the cell half-diagonal used as max dot radius at full ink. */
  dotMaxFrac: number
  /** 0 = paper only through dots; 1 = full ink strength (single: ink vs paper; layered: depth of multiply stack). */
  dotOpacity: number
  /** 1 = linear; above 1 increases tonal separation around mid grey. */
  contrast: number
  grayscaleMode: GrayscaleMode
  imageInvert: boolean
  solarizeEnabled: boolean
  solarizeThreshold: number
  /** Simple box blur on per-cell tone before halftone (0 = off). */
  blurPasses: number
  useColor: boolean
  /** When useColor: HSL saturation multiplier (1 = unchanged). */
  colorSaturationPct: number
  /** #rrggbb ink when not sampling per-cell colour. */
  inkHex: string
  /** #rrggbb — non-ink areas (matches preview stage background). */
  paperHex: string
  animationPhase: number
  animHueEnabled: boolean
  alphaMatteHex?: string
  /**
   * Layered only: number of multiply inks (1–5). Ignored when dotModel is single.
   */
  layeredChannelCount: number
  /**
   * Layered only: one #rrggbb per channel (length should match layeredChannelCount;
   * shorter arrays are padded, extra entries ignored).
   */
  layeredInkHexes: string[]
  /**
   * Layered only: scales how far each ink screen sits from the others (misregistration).
   * Typical UI maps ~0–2.5 (e.g. 0–250%); larger values push channels further apart.
   */
  layerMisregistration: number
  /**
   * 0 = flat. Peak UV displacement in output pixels (subtle wave over the finished halftone).
   */
  warpStrengthPx: number
  /** How many wave cycles across the image width when warp strength is positive. */
  warpFrequency: number
}

export interface HalftoneResult {
  cols: number
  rows: number
  pixelsPerCell: number
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

function parseInkRgb(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return [10, 10, 10]
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function boxBlurCells(
  arr: Float32Array,
  cols: number,
  rows: number,
  passes: number
): void {
  if (passes <= 0) return
  const tmp = new Float32Array(cols * rows)
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let s = 0
        let c = 0
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= cols) continue
          s += arr[y * cols + nx]!
          c++
        }
        tmp[y * cols + x] = s / c
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let s = 0
        let c = 0
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= rows) continue
          s += tmp[ny * cols + x]!
          c++
        }
        arr[y * cols + x] = s / c
      }
    }
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function toneCurve(x: number, contrast: number): number {
  return clamp01((x - 0.5) * contrast + 0.5)
}

function sampleBilinearRgba(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  fx: number,
  fy: number
): [number, number, number, number] {
  const sx = Math.max(0, Math.min(w - 1 - 1e-7, fx))
  const sy = Math.max(0, Math.min(h - 1 - 1e-7, fy))
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const x1 = Math.min(x0 + 1, w - 1)
  const y1 = Math.min(y0 + 1, h - 1)
  const tx = sx - x0
  const ty = sy - y0
  const at = (x: number, y: number, c: number) => src[(y * w + x) * 4 + c]!
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const ch = (c: 0 | 1 | 2 | 3) =>
    lerp(
      lerp(at(x0, y0, c), at(x1, y0, c), tx),
      lerp(at(x0, y1, c), at(x1, y1, c), tx),
      ty
    )
  return [ch(0), ch(1), ch(2), ch(3)]
}

function applyWarpToImageData(
  src: ImageData,
  ampPx: number,
  freq: number,
  phaseRad: number
): ImageData {
  const W = src.width
  const H = src.height
  const out = new ImageData(W, H)
  const sd = src.data
  const od = out.data
  if (ampPx < 0.08) {
    od.set(sd)
    return out
  }
  const buf = new Uint8ClampedArray(sd)
  const twopi = Math.PI * 2
  const fxScale = freq
  const fyScale = freq * 0.92
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = px / Math.max(1, W - 1)
      const ny = py / Math.max(1, H - 1)
      const sx =
        px +
        Math.sin(ny * twopi * fxScale + phaseRad) * ampPx +
        Math.cos(nx * twopi * fxScale * 1.28 + phaseRad * 0.62) * ampPx * 0.42
      const sy =
        py +
        Math.cos(nx * twopi * fyScale + phaseRad * 0.55) * ampPx +
        Math.sin(ny * twopi * fyScale * 0.88 + phaseRad * 0.78) * ampPx * 0.35
      const o = (py * W + px) * 4
      const [r, g, b, a] = sampleBilinearRgba(buf, W, H, sx, sy)
      od[o] = r
      od[o + 1] = g
      od[o + 2] = b
      od[o + 3] = a
    }
  }
  return out
}

function inkDirectionUnit(hex: string): [number, number, number] {
  const [r255, g255, b255] = parseInkRgb(hex)
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
  const len = Math.hypot(r, g, b) + 1e-9
  return [r / len, g / len, b / len]
}

type CellSample = {
  L: number
  r: number
  g: number
  b: number
  alpha: number
}

/**
 * AM dot halftone: each cell maps tone to a circular dot on a supersampled grid.
 */
export function buildHalftone(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  params: HalftoneParams
): HalftoneResult {
  const cols = Math.max(2, Math.floor(params.columns))
  const rows = Math.max(
    2,
    Math.round((cols * naturalHeight) / naturalWidth)
  )
  /** Keep total output pixels bounded for interactive preview. */
  const maxTotalPx = 2_200_000
  const maxPpc = Math.max(
    2,
    Math.floor(Math.sqrt(maxTotalPx / Math.max(1, cols * rows)))
  )
  const ppc = Math.max(
    2,
    Math.min(maxPpc, Math.min(24, Math.round(params.pixelsPerCell)))
  )
  const W = cols * ppc
  const H = rows * ppc

  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    const empty = new ImageData(W, H)
    return { cols, rows, pixelsPerCell: ppc, imageData: empty }
  }

  ctx.drawImage(source, 0, 0, cols, rows)
  const { data } = ctx.getImageData(0, 0, cols, rows)
  const [mr, mg, mb] = alphaMatteRgb255(params.alphaMatteHex)

  const n = cols * rows
  const cells: CellSample[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    let r = data[o]!
    let g = data[o + 1]!
    let b = data[o + 2]!
    const a = data[o + 3]! / 255
    r = r * a + mr * (1 - a)
    g = g * a + mg * (1 - a)
    b = b * a + mb * (1 - a)
    let L = grayscaleFrom(r, g, b, params.grayscaleMode)
    if (params.imageInvert) L = 255 - L
    if (params.solarizeEnabled && L > params.solarizeThreshold) {
      L = 255 - L
    }
    cells[i] = { L, r, g, b, alpha: a }
  }

  const Lbuf = new Float32Array(n)
  for (let i = 0; i < n; i++) Lbuf[i] = cells[i]!.L
  const passes = Math.max(0, Math.min(6, Math.round(params.blurPasses)))
  boxBlurCells(Lbuf, cols, rows, passes)
  for (let i = 0; i < n; i++) cells[i]!.L = Lbuf[i]!

  const contrast = Math.max(0.35, Math.min(2.5, params.contrast))
  const dotMaxFrac = Math.max(0.05, Math.min(1, params.dotMaxFrac))
  const isLayered = params.dotModel === 'layered'
  const nCh = Math.max(
    1,
    Math.min(5, Math.round(params.layeredChannelCount))
  )
  const misScale =
    Math.max(0, Math.min(2.5, params.layerMisregistration)) * 0.22
  const dotOp = Math.max(0, Math.min(1, params.dotOpacity))

  const inkBase = parseInkRgb(params.inkHex)
  const paperRgb = parseInkRgb(params.paperHex)
  const satMult = Math.max(0, Math.min(3, params.colorSaturationPct / 100))

  const hexesRaw = params.layeredInkHexes.slice(0, nCh)
  const inkHexes: string[] = []
  for (let k = 0; k < nCh; k++) {
    inkHexes.push(hexesRaw[k] ?? '#2a2a2a')
  }
  const inkDirs = inkHexes.map((h) => inkDirectionUnit(h))
  const inkMul = inkHexes.map((h) => {
    const [r, g, b] = parseInkRgb(h)
    return [r / 255, g / 255, b / 255] as const
  })

  const driveBufs: Float32Array[] = []
  if (isLayered) {
    for (let k = 0; k < nCh; k++) driveBufs.push(new Float32Array(n))
    for (let i = 0; i < n; i++) {
      const c = cells[i]!
      let r = c.r
      let g = c.g
      let b = c.b
      if (Math.abs(satMult - 1) > 1e-6) {
        ;[r, g, b] = adjustSaturation(r, g, b, satMult)
      }
      if (params.imageInvert) {
        r = 255 - r
        g = 255 - g
        b = 255 - b
      }
      const Ls = grayscaleFrom(r, g, b, params.grayscaleMode)
      if (params.solarizeEnabled && Ls > params.solarizeThreshold) {
        r = 255 - r
        g = 255 - g
        b = 255 - b
      }
      const rn = r / 255
      const gn = g / 255
      const bn = b / 255
      for (let k = 0; k < nCh; k++) {
        const [ur, ug, ub] = inkDirs[k]!
        const raw = rn * ur + gn * ug + bn * ub
        driveBufs[k]![i] = toneCurve(clamp01(raw * 1.22), contrast)
      }
    }
    if (passes > 0) {
      for (let k = 0; k < nCh; k++) {
        boxBlurCells(driveBufs[k]!, cols, rows, passes)
      }
    }
  }

  const out = new ImageData(W, H)
  const od = out.data

  /** Max dot radius in cell units (cell half-width = 0.5). */
  const maxR = 0.5 * Math.SQRT2 * dotMaxFrac
  const pr255 = paperRgb[0]!
  const pg255 = paperRgb[1]!
  const pb255 = paperRgb[2]!
  const prn = pr255 / 255
  const pgn = pg255 / 255
  const pbn = pb255 / 255

  if (isLayered && driveBufs.length === nCh) {
    const wob = params.animHueEnabled ? params.animationPhase * 6.283185307179586 : 0
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const u = px / W
        const v = py / H
        const o = (py * W + px) * 4
        const fx = u * cols
        const fy = v * rows
        const ci = Math.min(cols - 1, Math.max(0, Math.floor(fx - 1e-9)))
        const cj = Math.min(rows - 1, Math.max(0, Math.floor(fy - 1e-9)))
        const lu = fx - ci - 0.5
        const lv = fy - cj - 0.5
        const idx = cj * cols + ci
        const cell = cells[idx]!
        if (outputAlphaByte(cell.alpha) === 0) {
          od[o + 3] = 0
          continue
        }
        let cr = prn
        let cg = pgn
        let cb = pbn
        for (let li = 0; li < nCh; li++) {
          const angle = (2 * Math.PI * li) / nCh + 0.28
          const ox =
            Math.cos(angle) * misScale * 0.92 +
            Math.sin((px + py) * 0.07 + wob + li * 1.7) * 0.028 * misScale
          const oy =
            Math.sin(angle) * misScale * 0.92 +
            Math.cos((px - py) * 0.06 + wob * 0.85 + li) * 0.025 * misScale
          const lu2 = lu - ox
          const lv2 = lv - oy
          const dist = Math.hypot(lu2, lv2)
          const dr = driveBufs[li]![idx]!
          const radius = (1 - dr) * maxR
          if (dist < radius) {
            const ink = inkMul[li]!
            cr *= ink[0]
            cg *= ink[1]
            cb *= ink[2]
          }
        }
        cr = prn + (cr - prn) * dotOp
        cg = pgn + (cg - pgn) * dotOp
        cb = pbn + (cb - pbn) * dotOp
        od[o] = clamp255(cr * 255)
        od[o + 1] = clamp255(cg * 255)
        od[o + 2] = clamp255(cb * 255)
        od[o + 3] = 255
      }
    }
  } else {
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const u = px / W
        const v = py / H
        const o = (py * W + px) * 4

        const fx = u * cols
        const fy = v * rows
        const ci = Math.min(cols - 1, Math.max(0, Math.floor(fx - 1e-9)))
        const cj = Math.min(rows - 1, Math.max(0, Math.floor(fy - 1e-9)))
        const lu = fx - ci - 0.5
        const lv = fy - cj - 0.5
        const dist = Math.hypot(lu, lv)

        const cell = cells[cj * cols + ci]!
        if (outputAlphaByte(cell.alpha) === 0) {
          od[o + 3] = 0
          continue
        }

        let Ln = Math.max(0, Math.min(1, cell.L / 255))
        Ln = toneCurve(Ln, contrast)
        const radius = (1 - Ln) * maxR

        let ir: number
        let ig: number
        let ib: number
        if (params.useColor) {
          ;[ir, ig, ib] =
            satMult !== 1
              ? adjustSaturation(cell.r, cell.g, cell.b, satMult)
              : [clamp255(cell.r), clamp255(cell.g), clamp255(cell.b)]
          if (params.animHueEnabled) {
            ;[ir, ig, ib] = hueRotateRgb(
              ir,
              ig,
              ib,
              params.animationPhase * 360
            )
          }
        } else {
          ;[ir, ig, ib] = inkBase
          if (params.animHueEnabled) {
            ;[ir, ig, ib] = hueRotateRgb(
              ir,
              ig,
              ib,
              params.animationPhase * 360
            )
          }
        }

        if (dist < radius) {
          od[o] = clamp255(pr255 + (ir - pr255) * dotOp)
          od[o + 1] = clamp255(pg255 + (ig - pg255) * dotOp)
          od[o + 2] = clamp255(pb255 + (ib - pb255) * dotOp)
          od[o + 3] = 255
        } else {
          od[o] = pr255
          od[o + 1] = pg255
          od[o + 2] = pb255
          od[o + 3] = 255
        }
      }
    }
  }

  const warpAmp = Math.max(0, Math.min(W * 0.06, params.warpStrengthPx))
  const warpF = Math.max(0.35, Math.min(12, params.warpFrequency))
  const phaseRad = params.animationPhase * Math.PI * 2
  const finalData =
    warpAmp >= 0.08 ? applyWarpToImageData(out, warpAmp, warpF, phaseRad) : out

  return { cols, rows, pixelsPerCell: ppc, imageData: finalData }
}

export function halftoneToPngBlob(
  result: HalftoneResult,
  opts: { scale: number; background: string; pixelRatio: number }
): Promise<Blob | null> {
  const { cols, rows, pixelsPerCell, imageData } = result
  const iw = cols * pixelsPerCell
  const ih = rows * pixelsPerCell
  const scale = Math.max(1, Math.min(32, opts.scale))
  const pr = Math.max(1, Math.min(4, opts.pixelRatio))
  const w = Math.round(iw * scale * pr)
  const h = Math.round(ih * scale * pr)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)

  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = opts.background
  ctx.fillRect(0, 0, w, h)

  const tmp = document.createElement('canvas')
  tmp.width = iw
  tmp.height = ih
  const tctx = tmp.getContext('2d')
  if (!tctx) return Promise.resolve(null)
  tctx.putImageData(imageData, 0, 0)

  ctx.save()
  ctx.scale(pr, pr)
  ctx.drawImage(tmp, 0, 0, iw, ih, 0, 0, iw * scale, ih * scale)
  ctx.restore()

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}
