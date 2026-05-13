/**
 * Marching squares on a regular scalar corner grid → line segments in viewBox space,
 * then merged into SVG path `d` strings (continuous strokes, topo-map style).
 *
 * Corner layout per cell (x,y): TL=(x,y), TR=(x+1,y), BR=(x+1,y+1), BL=(x,y+1).
 * Bit index: TL=8, TR=4, BR=2, BL=1 (inside = value >= iso).
 */

import { escapeXml } from './asciiPipeline'

export type ContourPathSet = {
  /** viewBox "0 0 width height" — height uses 2× row count to match ASCII cell aspect */
  viewBoxWidth: number
  viewBoxHeight: number
  /** One path per iso level; `d` uses absolute coordinates in viewBox space */
  paths: { iso: number; d: string }[]
}

const PT_EPS = 1e-5

function isoCut(
  iso: number,
  va: number,
  vb: number,
  pa: [number, number],
  pb: [number, number]
): [number, number] | null {
  const fa = va >= iso
  const fb = vb >= iso
  if (fa === fb) return null
  const den = vb - va
  if (Math.abs(den) < 1e-12) return null
  const t = (iso - va) / den
  if (!Number.isFinite(t)) return null
  return [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]
}

/** Local cell coords: TL (0,0), TR (1,0), BR (1,1), BL (0,1); y increases downward. */
function edgePoint(
  edge: 0 | 1 | 2 | 3,
  iso: number,
  tl: number,
  tr: number,
  br: number,
  bl: number
): [number, number] | null {
  switch (edge) {
    case 0:
      return isoCut(iso, tl, tr, [0, 0], [1, 0])
    case 1:
      return isoCut(iso, tr, br, [1, 0], [1, 1])
    case 2:
      return isoCut(iso, br, bl, [1, 1], [0, 1])
    case 3:
      return isoCut(iso, bl, tl, [0, 1], [0, 0])
    default:
      return null
  }
}

function segmentEndpoints(
  idx: number,
  iso: number,
  tl: number,
  tr: number,
  br: number,
  bl: number
): [[number, number], [number, number]][] {
  if (idx === 0 || idx === 15) return []

  const edgePair = (a: 0 | 1 | 2 | 3, b: 0 | 1 | 2 | 3): [[number, number], [number, number]][] => {
    const pa = edgePoint(a, iso, tl, tr, br, bl)
    const pb = edgePoint(b, iso, tl, tr, br, bl)
    if (!pa || !pb) return []
    return [[pa, pb]]
  }

  if (idx === 5) {
    const avg = (tl + tr + br + bl) / 4
    return avg >= iso
      ? [
          [
            edgePoint(3, iso, tl, tr, br, bl)!,
            edgePoint(0, iso, tl, tr, br, bl)!,
          ],
          [
            edgePoint(1, iso, tl, tr, br, bl)!,
            edgePoint(2, iso, tl, tr, br, bl)!,
          ],
        ]
      : [
          [
            edgePoint(0, iso, tl, tr, br, bl)!,
            edgePoint(1, iso, tl, tr, br, bl)!,
          ],
          [
            edgePoint(2, iso, tl, tr, br, bl)!,
            edgePoint(3, iso, tl, tr, br, bl)!,
          ],
        ]
  }
  if (idx === 10) {
    const avg = (tl + tr + br + bl) / 4
    return avg >= iso
      ? [
          [
            edgePoint(0, iso, tl, tr, br, bl)!,
            edgePoint(1, iso, tl, tr, br, bl)!,
          ],
          [
            edgePoint(2, iso, tl, tr, br, bl)!,
            edgePoint(3, iso, tl, tr, br, bl)!,
          ],
        ]
      : [
          [
            edgePoint(3, iso, tl, tr, br, bl)!,
            edgePoint(0, iso, tl, tr, br, bl)!,
          ],
          [
            edgePoint(1, iso, tl, tr, br, bl)!,
            edgePoint(2, iso, tl, tr, br, bl)!,
          ],
        ]
  }

  switch (idx) {
    case 1:
      return edgePair(3, 2)
    case 2:
      return edgePair(2, 1)
    case 3:
      return edgePair(3, 1)
    case 4:
      return edgePair(0, 1)
    case 6:
      return edgePair(0, 2)
    case 7:
      return edgePair(0, 3)
    case 8:
      return edgePair(0, 3)
    case 9:
      return edgePair(0, 2)
    case 11:
      return edgePair(0, 1)
    case 12:
      return edgePair(3, 1)
    case 13:
      return edgePair(1, 2)
    case 14:
      return edgePair(2, 3)
    default:
      return []
  }
}

function dist2(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

/**
 * Greedy merge of small segments into longer polylines (reduces SVG size, smoother joins).
 */
function mergeSegmentsToPaths(
  segments: [[number, number], [number, number]][]
): string[] {
  if (segments.length === 0) return []

  type Seg = { a: [number, number]; b: [number, number]; used: boolean }
  const segs: Seg[] = segments.map(([a, b]) => ({ a, b, used: false }))

  const paths: string[] = []

  const snap = (p: [number, number]): [number, number] => [
    Math.round(p[0] * 1e6) / 1e6,
    Math.round(p[1] * 1e6) / 1e6,
  ]

  const near = (u: [number, number], v: [number, number]) =>
    dist2(u, v) < PT_EPS * PT_EPS * 4

  for (let guard = 0; guard < segs.length * 4; guard++) {
    let start = segs.find((s) => !s.used)
    if (!start) break
    start.used = true
    let chain: [number, number][] = [snap(start.a), snap(start.b)]
    let head = chain[0]!
    let tail = chain[chain.length - 1]!

    let extended = true
    while (extended) {
      extended = false
      for (const s of segs) {
        if (s.used) continue
        const sa = snap(s.a)
        const sb = snap(s.b)
        if (near(sa, tail)) {
          chain.push(sb)
          tail = sb
          s.used = true
          extended = true
          break
        }
        if (near(sb, tail)) {
          chain.push(sa)
          tail = sa
          s.used = true
          extended = true
          break
        }
        if (near(sa, head)) {
          chain.unshift(sb)
          head = sb
          s.used = true
          extended = true
          break
        }
        if (near(sb, head)) {
          chain.unshift(sa)
          head = sa
          s.used = true
          extended = true
          break
        }
      }
    }

    const fmt = (p: [number, number]) => `${p[0]} ${p[1]}`
    paths.push(`M ${fmt(chain[0]!)} L ${chain.slice(1).map(fmt).join(' L ')}`)
  }

  return paths
}

function cellIndex(tl: number, tr: number, br: number, bl: number, iso: number): number {
  return (
    (tl >= iso ? 8 : 0) |
    (tr >= iso ? 4 : 0) |
    (br >= iso ? 2 : 0) |
    (bl >= iso ? 1 : 0)
  )
}

function cornerVal(gray: Float32Array, w: number, x: number, y: number): number {
  return gray[y * w + x]!
}

/**
 * @param gray corner samples, width `cw`, height `ch`
 * @param cols cells horizontally = cw - 1
 * @param rows cells vertically = ch - 1
 * @param lineGridMul internal grid is this many times finer than (cols+1)×(rows+1) for smoother lines; 1 = same as corners
 */
export function buildContourVectorPaths(
  gray: Float32Array,
  cw: number,
  ch: number,
  cols: number,
  rows: number,
  levels: number[],
  lineGridMul: number
): ContourPathSet {
  const mul = Math.max(1, Math.min(8, Math.round(lineGridMul)))
  const fw = cols * mul + 1
  const fh = rows * mul + 1

  let field: Float32Array
  if (mul === 1) {
    field = gray
  } else {
    field = new Float32Array(fw * fh)
    for (let j = 0; j < fh; j++) {
      const gy = j / mul
      const y0 = Math.floor(gy)
      const y1 = Math.min(ch - 1, y0 + 1)
      const ty = gy - y0
      for (let i = 0; i < fw; i++) {
        const gx = i / mul
        const x0 = Math.floor(gx)
        const x1 = Math.min(cw - 1, x0 + 1)
        const tx = gx - x0
        const v00 = cornerVal(gray, cw, x0, y0)
        const v10 = cornerVal(gray, cw, x1, y0)
        const v01 = cornerVal(gray, cw, x0, y1)
        const v11 = cornerVal(gray, cw, x1, y1)
        const top = v00 * (1 - tx) + v10 * tx
        const bot = v01 * (1 - tx) + v11 * tx
        field[j * fw + i] = top * (1 - ty) + bot * ty
      }
    }
  }

  const w = mul === 1 ? cw : fw
  const h = mul === 1 ? ch : fh
  const cellCols = w - 1
  const cellRows = h - 1

  const viewBoxWidth = cols
  const viewBoxHeight = rows * 2

  const toView = (gx: number, gy: number): [number, number] => [
    gx / mul,
    (2 * gy) / mul,
  ]

  const paths: { iso: number; d: string }[] = []

  for (const iso of levels) {
    const segments: [[number, number], [number, number]][] = []

    for (let cy = 0; cy < cellRows; cy++) {
      for (let cx = 0; cx < cellCols; cx++) {
        const tl = cornerVal(field, w, cx, cy)
        const tr = cornerVal(field, w, cx + 1, cy)
        const br = cornerVal(field, w, cx + 1, cy + 1)
        const bl = cornerVal(field, w, cx, cy + 1)
        const idx = cellIndex(tl, tr, br, bl, iso)
        const segs = segmentEndpoints(idx, iso, tl, tr, br, bl)
        for (const [p0, p1] of segs) {
          const q0 = toView(cx + p0[0], cy + p0[1])
          const q1 = toView(cx + p1[0], cy + p1[1])
          segments.push([q0, q1])
        }
      }
    }

    const merged = mergeSegmentsToPaths(segments)
    const d = merged.join(' ')
    if (d.length > 0) paths.push({ iso, d })
  }

  return { viewBoxWidth, viewBoxHeight, paths }
}

export function contourPathsToSvgDocument(
  set: ContourPathSet,
  opts: { stroke: string; strokeWidth: number; background?: string }
): string {
  const vb = `0 0 ${set.viewBoxWidth} ${set.viewBoxHeight}`
  const stroke = escapeXml(opts.stroke)
  const sw = escapeXml(String(opts.strokeWidth))
  const bgRect = opts.background
    ? `<rect width="100%" height="100%" fill="${escapeXml(opts.background)}"/>`
    : ''
  const pathEls = set.paths
    .map(
      (p) =>
        `<path fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" d="${escapeXml(p.d)}" />`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">\n${bgRect}\n${pathEls}\n</svg>`
}
