import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  asciiOverlayToSvg,
  asciiResultToSvg,
  buildAscii,
  type AnimationMode,
  type AsciiResult,
  type GrayscaleMode,
} from './asciiPipeline'
import { DEFAULT_CHARSET } from './charset'
import {
  asciiOverlayToPngBlob,
  asciiResultToPngBlob,
  bitmapToPngDataUrl,
  underlayImgStyle,
} from './exportPng'
import horseAscii from './assets/horse-ascii.png'
import horseHomeAscii from './assets/horse-home-ascii.png'
import horseHome8bit from './assets/horse-home-8bit.png'
import './App.css'
import { EightBitTool } from './pages/EightBitTool'
import { BrandLogoHoverMark, ToolBrandHomeLink } from './toolUi'

const CHARSET_PRESETS: { label: string; value: string }[] = [
  { label: 'Detailed', value: DEFAULT_CHARSET },
  { label: 'Blocks', value: ' ░▒▓█' },
  { label: 'Simple', value: ' .:-=+*#%@' },
  { label: 'Minimal', value: ' .:oO8@' },
]

const GRAYSCALE_MODES: GrayscaleMode[] = [
  'luminance',
  'average',
  'lightness',
  'red',
  'green',
  'blue',
]

const ANIM_MODES: AnimationMode[] = [
  'hue',
  'ramp',
  'solarize',
  'sharpen',
  'edge',
  'blur',
]

const PRIVACY_NOTE =
  'Photos stay in your browser: we do not upload or store them. Remove background runs locally; only ML model files may download from the vendor CDN, not your image.'

type PresetSettings = {
  columns: number
  charset: string
  rampInvert: boolean
  grayscaleMode: GrayscaleMode
  imageInvert: boolean
  solarizeEnabled: boolean
  solarizeThreshold: number
  blurPasses: number
  sharpenAmount: number
  edgeEmphasis: number
  useColor: boolean
  colorSaturationPct: number
  animEnabled: boolean
  animMode: AnimationMode
  animSpeed: number
  asciiBackground: string
  grayscaleGlyphColor: string
  overlayOnImage: boolean
  /** v2 preset fields — omitted in older saved presets */
  overlayPhotoGrayscale?: boolean
  overlayPhotoOpacity?: number
  overlayPhotoHueDeg?: number
  grayscaleHueTintEnabled?: boolean
  grayscaleHueTintDeg?: number
  grayscaleHueTintSaturationPct?: number
}

type SettingsPreset = {
  id: string
  name: string
  createdAt: number
  settings: PresetSettings
}

/** Presets store only settings — never image data — so the privacy promise holds. */
const PRESETS_STORAGE_KEY = 'ascii-creator:presets:v1'

function isValidPreset(value: unknown): value is SettingsPreset {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || typeof v.name !== 'string') return false
  const s = v.settings as Record<string, unknown> | undefined
  if (!s || typeof s !== 'object') return false
  return (
    typeof s.columns === 'number' &&
    typeof s.charset === 'string' &&
    typeof s.rampInvert === 'boolean' &&
    GRAYSCALE_MODES.includes(s.grayscaleMode as GrayscaleMode) &&
    typeof s.imageInvert === 'boolean' &&
    typeof s.solarizeEnabled === 'boolean' &&
    typeof s.solarizeThreshold === 'number' &&
    typeof s.blurPasses === 'number' &&
    typeof s.sharpenAmount === 'number' &&
    typeof s.edgeEmphasis === 'number' &&
    typeof s.useColor === 'boolean' &&
    typeof s.colorSaturationPct === 'number' &&
    typeof s.animEnabled === 'boolean' &&
    ANIM_MODES.includes(s.animMode as AnimationMode) &&
    typeof s.animSpeed === 'number' &&
    typeof s.asciiBackground === 'string' &&
    typeof s.grayscaleGlyphColor === 'string' &&
    typeof s.overlayOnImage === 'boolean' &&
    (typeof s.overlayPhotoGrayscale === 'boolean' ||
      s.overlayPhotoGrayscale === undefined) &&
    (typeof s.overlayPhotoOpacity === 'number' ||
      s.overlayPhotoOpacity === undefined) &&
    (typeof s.overlayPhotoHueDeg === 'number' ||
      s.overlayPhotoHueDeg === undefined) &&
    (typeof s.grayscaleHueTintEnabled === 'boolean' ||
      s.grayscaleHueTintEnabled === undefined) &&
    (typeof s.grayscaleHueTintDeg === 'number' ||
      s.grayscaleHueTintDeg === undefined) &&
    (typeof s.grayscaleHueTintSaturationPct === 'number' ||
      s.grayscaleHueTintSaturationPct === undefined)
  )
}

function loadPresets(): SettingsPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const migrated = parsed.map((p: unknown) => {
      if (!p || typeof p !== 'object') return p
      const entry = p as Record<string, unknown>
      const s = entry.settings
      if (!s || typeof s !== 'object') return p
      const st = s as Record<string, unknown>
      if (st.animMode === 'glow') {
        return {
          ...entry,
          settings: { ...st, animMode: 'blur' },
        }
      }
      return p
    })
    return migrated.filter(isValidPreset)
  } catch {
    return []
  }
}

function persistPresets(presets: SettingsPreset[]): void {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets))
  } catch {
    /* quota or storage disabled — preset is kept in-memory for this session only. */
  }
}

function createPresetId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randBool(): boolean {
  return Math.random() < 0.5
}

function randHexColor(): string {
  return `#${randInt(0, 0xffffff)
    .toString(16)
    .padStart(6, '0')}`
}

function parseHex6(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function relativeLuminance(hex: string): number {
  const t = parseHex6(hex)
  if (!t) return 0.5
  const lin = (c: number) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = t
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrastRatio(hexA: string, hexB: string): number {
  const La = relativeLuminance(hexA)
  const Lb = relativeLuminance(hexB)
  const lighter = Math.max(La, Lb)
  const darker = Math.min(La, Lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG-style contrast; retries until ratio is met (glyph vs stage background). */
function randomContrastingBgAndGlyph(): { bg: string; glyph: string } {
  const bg = randHexColor()
  for (let i = 0; i < 72; i++) {
    const glyph = randHexColor()
    if (contrastRatio(bg, glyph) >= 4) return { bg, glyph }
  }
  const L = relativeLuminance(bg)
  const glyph = L > 0.5 ? '#0a0a0a' : '#f5f5f5'
  return { bg, glyph }
}

function randomCharsetString(): string {
  if (Math.random() < 0.65) {
    const p = CHARSET_PRESETS[randInt(0, CHARSET_PRESETS.length - 1)]!
    return p.value
  }
  const pool = `${DEFAULT_CHARSET}░▒▓█ `
  let s = ''
  const len = randInt(4, 28)
  for (let i = 0; i < len; i++) {
    s += pool[randInt(0, pool.length - 1)]!
  }
  return s
}

function pct(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
}

function clampNum(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

const APP_TIP_MAX = 240
const APP_TIP_PAD = 12

function clearAppTooltipPosition(el: HTMLElement): void {
  delete el.dataset.tipPositioned
  for (const p of [
    '--app-tip-left',
    '--app-tip-top',
    '--app-tip-transform',
    '--app-tip-text-align',
    '--app-tip-max-h',
  ] as const) {
    el.style.removeProperty(p)
  }
}

function scheduleTooltipClear(el: HTMLElement): void {
  requestAnimationFrame(() => {
    if (!el.matches(':focus-within') && !el.matches(':hover')) {
      clearAppTooltipPosition(el)
    }
  })
}

function setAppTooltipPosition(el: HTMLElement, kind: 'rail' | 'info'): void {
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const narrow = vw <= 960

  if (kind === 'rail') {
    if (narrow) {
      const cx = clampNum(
        r.left + r.width / 2,
        APP_TIP_PAD + APP_TIP_MAX / 2,
        vw - APP_TIP_PAD - APP_TIP_MAX / 2
      )
      const top = r.top - 10
      el.style.setProperty('--app-tip-left', `${cx}px`)
      el.style.setProperty('--app-tip-top', `${top}px`)
      el.style.setProperty('--app-tip-transform', 'translate(-50%, -100%)')
      el.style.setProperty('--app-tip-text-align', 'center')
      el.style.setProperty(
        '--app-tip-max-h',
        `min(50vh, ${Math.max(80, r.top - APP_TIP_PAD - 4)}px)`
      )
    } else {
      const cy = clampNum(r.top + r.height / 2, APP_TIP_PAD, vh - APP_TIP_PAD)
      let anchorX = r.left - 10
      const minAnchor = APP_TIP_PAD + APP_TIP_MAX
      if (anchorX < minAnchor) anchorX = minAnchor
      const maxAnchor = vw - APP_TIP_PAD
      if (anchorX > maxAnchor) anchorX = maxAnchor
      el.style.setProperty('--app-tip-left', `${anchorX}px`)
      el.style.setProperty('--app-tip-top', `${cy}px`)
      el.style.setProperty('--app-tip-transform', 'translate(-100%, -50%)')
      el.style.setProperty('--app-tip-text-align', 'center')
      el.style.setProperty(
        '--app-tip-max-h',
        `min(70vh, ${Math.max(120, cy - APP_TIP_PAD, vh - cy - APP_TIP_PAD)}px)`
      )
    }
  } else if (narrow) {
    const cx = clampNum(
      r.left + r.width / 2,
      APP_TIP_PAD + APP_TIP_MAX / 2,
      vw - APP_TIP_PAD - APP_TIP_MAX / 2
    )
    const top = r.bottom + 10
    el.style.setProperty('--app-tip-left', `${cx}px`)
    el.style.setProperty('--app-tip-top', `${top}px`)
    el.style.setProperty('--app-tip-transform', 'translate(-50%, 0)')
    el.style.setProperty('--app-tip-text-align', 'left')
    el.style.setProperty(
      '--app-tip-max-h',
      `min(50vh, ${Math.max(80, vh - top - APP_TIP_PAD)}px)`
    )
  } else {
    let left = r.right + 10
    left = clampNum(left, APP_TIP_PAD, vw - APP_TIP_PAD - APP_TIP_MAX)
    const anchorMidY = r.top + r.height / 2
    /** Half of a typical tall tip; avoids translateY(-50%) clipping off the top/bottom. */
    const estHalfTip = 88
    const roomAbove = anchorMidY - APP_TIP_PAD
    const roomBelow = vh - anchorMidY - APP_TIP_PAD
    let top: number
    let transform: string
    let maxHExpr: string
    if (roomAbove < estHalfTip && roomBelow >= roomAbove) {
      top = r.bottom + 10
      transform = 'translateY(0)'
      maxHExpr = `min(70vh, ${Math.max(80, vh - top - APP_TIP_PAD)}px)`
    } else if (roomBelow < estHalfTip && roomAbove > roomBelow) {
      top = r.top - 10
      transform = 'translateY(-100%)'
      maxHExpr = `min(70vh, ${Math.max(80, top - APP_TIP_PAD)}px)`
    } else {
      const cy = clampNum(anchorMidY, APP_TIP_PAD, vh - APP_TIP_PAD)
      top = cy
      transform = 'translateY(-50%)'
      maxHExpr = `min(70vh, ${Math.max(120, cy - APP_TIP_PAD, vh - cy - APP_TIP_PAD)}px)`
    }
    el.style.setProperty('--app-tip-left', `${left}px`)
    el.style.setProperty('--app-tip-top', `${top}px`)
    el.style.setProperty('--app-tip-transform', transform)
    el.style.setProperty('--app-tip-text-align', 'left')
    el.style.setProperty('--app-tip-max-h', maxHExpr)
  }

  el.dataset.tipPositioned = '1'
}

function TooltipSpan({
  kind,
  tip,
  className,
  children,
}: {
  kind: 'rail' | 'info'
  tip: string
  className: string
  children: ReactNode
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const update = useCallback(() => {
    const el = ref.current
    if (el) setAppTooltipPosition(el, kind)
  }, [kind])
  const clear = useCallback(() => {
    const el = ref.current
    if (el) scheduleTooltipClear(el)
  }, [])
  return (
    <span
      ref={ref}
      className={className}
      data-tooltip={tip}
      onPointerEnter={update}
      onPointerLeave={clear}
      onFocusCapture={update}
      onBlurCapture={clear}
    >
      {children}
    </span>
  )
}

function RailTip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <TooltipSpan kind="rail" tip={tip} className="rail-tip">
      {children}
    </TooltipSpan>
  )
}

type ComboboxOption<T extends string> = { value: T; label: string }

/**
 * Custom dropdown that mirrors the .select look but renders its menu as a
 * fixed-position popover anchored to the trigger. Avoids the native <select>
 * popover from overlaying / "cutting" adjacent rich-check rows.
 */
function Combobox<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T
  options: ComboboxOption<T>[]
  onChange: (next: T) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({
    left: 0,
    top: 0,
    width: 0,
  })
  const [maxH, setMaxH] = useState(280)
  const [activeIndex, setActiveIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.find((o) => o.value === value) ?? options[0]
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )

  const updatePosition = useCallback(() => {
    const t = triggerRef.current
    if (!t) return
    const r = t.getBoundingClientRect()
    const vh = window.innerHeight
    const spaceBelow = vh - r.bottom - 12
    const spaceAbove = r.top - 12
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow
    const m = Math.max(120, Math.min(280, openUp ? spaceAbove : spaceBelow))
    setPos({
      left: r.left,
      top: openUp ? r.top - 6 : r.bottom + 6,
      width: r.width,
    })
    setMaxH(m)
    if (openUp) {
      popoverRef.current?.setAttribute('data-open-up', '1')
    } else {
      popoverRef.current?.removeAttribute('data-open-up')
    }
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    setActiveIndex(selectedIndex)
  }, [open, selectedIndex, updatePosition])

  useEffect(() => {
    if (!open) return
    const onScroll = () => updatePosition()
    const onResize = () => updatePosition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = triggerRef.current
      const p = popoverRef.current
      const target = e.target as Node
      if (t?.contains(target) || p?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const item = itemsRef.current[activeIndex]
    item?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => popoverRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const commit = (next: T) => {
    onChange(next)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp' ||
      e.key === 'Enter' ||
      e.key === ' '
    ) {
      e.preventDefault()
      setOpen(true)
    }
  }

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      requestAnimationFrame(() => triggerRef.current?.focus())
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % options.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + options.length) % options.length)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(options.length - 1)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const opt = options[activeIndex]
      if (opt) commit(opt.value)
    }
  }

  return (
    <div className="combobox">
      <button
        ref={triggerRef}
        type="button"
        className="select"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="combobox-value">{selected?.label ?? ''}</span>
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="combobox-menu"
          role="listbox"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          style={{
            left: pos.left,
            top: pos.top,
            width: pos.width,
            maxHeight: maxH,
          }}
        >
          {options.map((opt, i) => (
            <button
              key={opt.value}
              ref={(node) => {
                itemsRef.current[i] = node
              }}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              className={`combobox-item${i === activeIndex ? ' is-active' : ''}${opt.value === value ? ' is-selected' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => commit(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Scales ASCII to fit the stage (no scrollbars) while keeping native glyph sizing. */
function AsciiViewportFit({
  revision,
  children,
}: {
  revision: string
  children: ReactNode
}) {
  const vpRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ iw: 0, ih: 0, s: 1 })

  const measure = useCallback(() => {
    const vp = vpRef.current
    const inner = innerRef.current
    if (!vp || !inner) return
    const iw = Math.max(inner.offsetWidth, inner.scrollWidth)
    const ih = Math.max(inner.offsetHeight, inner.scrollHeight)
    if (iw < 1 || ih < 1) return
    const inset = 8
    const vw = Math.max(1, vp.clientWidth - inset * 2)
    const vh = Math.max(1, vp.clientHeight - inset * 2)
    const s = Math.min(1, vw / iw, vh / ih)
    setFit((prev) =>
      prev.iw === iw && prev.ih === ih && prev.s === s ? prev : { iw, ih, s }
    )
  }, [])

  useLayoutEffect(() => {
    measure()
    const id = requestAnimationFrame(() => measure())
    return () => cancelAnimationFrame(id)
  }, [revision, measure])

  useEffect(() => {
    const vp = vpRef.current
    const inner = innerRef.current
    if (!vp) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(vp)
    if (inner) ro.observe(inner)
    return () => ro.disconnect()
  }, [measure])

  const ready = fit.iw > 0 && fit.ih > 0

  return (
    <div ref={vpRef} className="ascii-scale-viewport">
      <div
        className="ascii-scale-slot"
        style={
          ready
            ? {
                width: fit.iw * fit.s,
                height: fit.ih * fit.s,
                position: 'relative',
              }
            : { position: 'relative', display: 'inline-block' }
        }
      >
        <div
          ref={innerRef}
          className="ascii-scale-inner"
          style={
            ready
              ? {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: fit.iw,
                  height: fit.ih,
                  transform: `scale(${fit.s})`,
                  transformOrigin: 'top left',
                }
              : { display: 'inline-block' }
          }
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/** Matches SVG export horizontal spacing so glyphs align with pipeline columns. */
const OVERLAY_GLYPH_ADVANCE_EM = 0.62

function AsciiImageOverlay({
  bitmap,
  previewUrl,
  asciiResult,
  photoGrayscale,
  photoOpacityPct,
  photoHueDeg,
}: {
  bitmap: ImageBitmap
  previewUrl: string
  asciiResult: AsciiResult
  photoGrayscale: boolean
  photoOpacityPct: number
  photoHueDeg: number
}) {
  const bw = bitmap.width
  const bh = bitmap.height
  const { cols, rows, lines } = asciiResult
  const cellW = bw / cols
  const cellH = bh / rows
  const fontSize = Math.max(
    2,
    Math.min(cellW / OVERLAY_GLYPH_ADVANCE_EM, cellH * 0.92)
  )
  const underlay = underlayImgStyle({
    photoGrayscale,
    photoOpacityPct,
    photoHueDeg,
  })

  return (
    <div className="ascii-overlay" style={{ width: bw, height: bh }}>
      <img
        className="ascii-overlay__img"
        src={previewUrl}
        alt=""
        width={bw}
        height={bh}
        draggable={false}
        style={{
          opacity: underlay.opacity,
          filter: underlay.filter,
        }}
      />
      <div
        className="ascii-overlay__glyphs"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          fontSize,
          lineHeight: `${cellH}px`,
        }}
      >
        {lines.map((row, yi) =>
          row.map((cell, xi) => (
            <span
              key={`${yi}-${xi}`}
              className="ascii-overlay__cell"
              style={{
                color: cell.color,
              }}
            >
              {cell.ch}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

function useImageBitmap(file: File | null) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)

  useEffect(() => {
    if (!file) {
      setBitmap((prev) => {
        prev?.close()
        return null
      })
      return
    }

    let cancelled = false

    void createImageBitmap(file).then((b) => {
      if (cancelled) {
        b.close()
        return
      }
      setBitmap((prev) => {
        prev?.close()
        return b
      })
    })

    return () => {
      cancelled = true
      setBitmap((prev) => {
        prev?.close()
        return null
      })
    }
  }, [file])

  return bitmap
}

type HomeHorseFocus = 'neutral' | 'ascii' | 'eight'

function HomeScreen(props: {
  onPickAscii: () => void
  onPickEightbit: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}) {
  const { onPickAscii, onPickEightbit, onDragOver, onDrop } = props
  const [horseFocus, setHorseFocus] = useState<HomeHorseFocus>('neutral')

  return (
    <div
      className="home-figma"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="home-figma__inner">
        <header className="home-figma__header">
          <BrandLogoHoverMark className="home-figma__mark" />
          <h1 className="home-figma__title">image player</h1>
          <p className="home-figma__sub">a jinny lee playground</p>
        </header>

        <div
          className={`home-figma__horse-stack home-figma__horse-stack--${horseFocus}`}
          aria-hidden
        >
          <img
            className="home-figma__horse-img home-figma__horse-img--8bit"
            src={horseHome8bit}
            alt=""
            draggable={false}
          />
          <img
            className="home-figma__horse-img home-figma__horse-img--ascii"
            src={horseHomeAscii}
            alt=""
            draggable={false}
          />
        </div>

        <nav className="home-figma__tools" aria-label="Tools">
          <button
            type="button"
            className="home-figma__tool"
            onClick={onPickAscii}
            onMouseEnter={() => setHorseFocus('ascii')}
            onMouseLeave={() => setHorseFocus('neutral')}
            onFocus={() => setHorseFocus('ascii')}
            onBlur={() => setHorseFocus('neutral')}
          >
            <span className="home-figma__tool-label">ascii</span>
          </button>
          <button
            type="button"
            className="home-figma__tool"
            onClick={onPickEightbit}
            onMouseEnter={() => setHorseFocus('eight')}
            onMouseLeave={() => setHorseFocus('neutral')}
            onFocus={() => setHorseFocus('eight')}
            onBlur={() => setHorseFocus('neutral')}
          >
            <span className="home-figma__tool-label">8bit</span>
          </button>
        </nav>
      </div>
    </div>
  )
}

function SidebarBrand({ onLogoClick }: { onLogoClick: () => void }) {
  return (
    <div className="sidebar-brand">
      <div className="sidebar-brand-logo-wrap">
        <TooltipSpan kind="info" tip="Back to home" className="info-tip-wrap">
          <ToolBrandHomeLink
            onPress={onLogoClick}
            ariaLabel="Back to home"
          />
        </TooltipSpan>
      </div>
      <div className="sidebar-brand-text">
        <div className="sidebar-brand-headline">
          <TooltipSpan
            kind="info"
            tip={PRIVACY_NOTE}
            className="info-tip-wrap privacy-tip-wrap"
          >
            <span className="privacy-headline-inner">
              <p className="sidebar-brand-title">ascii creator</p>
              <button
                type="button"
                className="info-btn"
                aria-label={PRIVACY_NOTE}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 3 5 6v5.5C5 16 8.5 19.5 12 21c3.5-1.5 7-5 7-9.5V6l-7-3Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </span>
          </TooltipSpan>
        </div>
        <p className="sidebar-brand-sub">by jinny lee</p>
      </div>
    </div>
  )
}

function InfoTip({ label }: { label: string }) {
  return (
    <TooltipSpan kind="info" tip={label} className="info-tip-wrap">
      <button
        type="button"
        className="info-btn"
        aria-label={label}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M12 10v6M12 7.5h.01"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </TooltipSpan>
  )
}

function RangeRow(props: {
  label: string
  valueLabel: string
  min: number
  max: number
  value: number
  step?: number
  onChange: (n: number) => void
  disabled?: boolean
}) {
  const { label, valueLabel, min, max, value, step = 1, onChange, disabled } =
    props
  const fill = pct(value, min, max)
  return (
    <div className={`range-block${disabled ? ' is-disabled' : ''}`}>
      <div className="row-label">
        <p className="section-label">{label}</p>
        <span className="value-hint">{valueLabel}</span>
      </div>
      <div className="range-track">
        <div className="range-fill" style={{ width: `${fill}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  )
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [columns, setColumns] = useState(100)
  const [charset, setCharset] = useState(DEFAULT_CHARSET)
  const [rampInvert, setRampInvert] = useState(false)
  const [grayscaleMode, setGrayscaleMode] = useState<GrayscaleMode>('luminance')
  const [imageInvert, setImageInvert] = useState(false)
  const [solarizeEnabled, setSolarizeEnabled] = useState(false)
  const [solarizeThreshold, setSolarizeThreshold] = useState(128)
  const [blurPasses, setBlurPasses] = useState(0)
  const [sharpenAmount, setSharpenAmount] = useState(0)
  const [edgeEmphasis, setEdgeEmphasis] = useState(0)
  const [useColor, setUseColor] = useState(false)
  const [colorSaturationPct, setColorSaturationPct] = useState(100)
  const [animEnabled, setAnimEnabled] = useState(false)
  const [animMode, setAnimMode] = useState<AnimationMode>('hue')
  const [animSpeed, setAnimSpeed] = useState(1)
  const [phase, setPhase] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle')
  const [asciiBackground, setAsciiBackground] = useState('#ffffff')
  const [grayscaleGlyphColor, setGrayscaleGlyphColor] = useState('#0a0a0a')
  const [grayscaleHueTintEnabled, setGrayscaleHueTintEnabled] = useState(false)
  const [grayscaleHueTintDeg, setGrayscaleHueTintDeg] = useState(0)
  const [grayscaleHueTintSaturationPct, setGrayscaleHueTintSaturationPct] =
    useState(62)
  const [overlayOnImage, setOverlayOnImage] = useState(false)
  const [overlayPhotoGrayscale, setOverlayPhotoGrayscale] = useState(false)
  const [overlayPhotoOpacity, setOverlayPhotoOpacity] = useState(100)
  const [overlayPhotoHueDeg, setOverlayPhotoHueDeg] = useState(0)
  const [exportOpen, setExportOpen] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [presets, setPresets] = useState<SettingsPreset[]>(() => loadPresets())
  const [newPresetName, setNewPresetName] = useState('')
  const [presetSavedFlash, setPresetSavedFlash] = useState(false)
  const [bgRemoveBusy, setBgRemoveBusy] = useState(false)
  const [bgRemoveError, setBgRemoveError] = useState<string | null>(null)
  /** Processed image used only for ASCII; original `file` stays for preview / overlay. */
  const [nobgFile, setNobgFile] = useState<File | null>(null)
  const [appScreen, setAppScreen] = useState<'home' | 'eightbit' | 'workspace'>(
    'home'
  )
  const [diceSpinning, setDiceSpinning] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const charsetTextareaRef = useRef<HTMLTextAreaElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const presetsRef = useRef<HTMLDivElement>(null)
  const presetNameInputRef = useRef<HTMLInputElement>(null)
  const railGradId = useId().replace(/:/g, '')

  const sourceBitmap = useImageBitmap(file)
  const nobgBitmap = useImageBitmap(nobgFile)
  const nobgReady = nobgFile != null && nobgBitmap != null
  const asciiBitmap = nobgReady ? nobgBitmap : sourceBitmap

  const previewUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (!file) {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
      setPreviewUrl(null)
      return
    }
    const next = URL.createObjectURL(file)
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = next
    setPreviewUrl(next)
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
      setPreviewUrl(null)
    }
  }, [file])

  useEffect(() => {
    if (!exportOpen) return
    const close = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [exportOpen])

  useEffect(() => {
    if (!presetsOpen) return
    const close = (e: MouseEvent) => {
      if (
        presetsRef.current &&
        !presetsRef.current.contains(e.target as Node)
      ) {
        setPresetsOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [presetsOpen])

  useEffect(() => {
    persistPresets(presets)
  }, [presets])

  useEffect(() => {
    if (!solarizeEnabled && animMode === 'solarize') {
      setAnimMode('hue')
    }
  }, [solarizeEnabled, animMode])

  useEffect(() => {
    if (!presetsOpen) return
    const id = requestAnimationFrame(() => presetNameInputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [presetsOpen])

  const animActive = animEnabled && !!sourceBitmap
  const lastAnimTick = useRef(0)
  const animFrame = useRef(0)

  useEffect(() => {
    if (!animActive) {
      setPhase(0)
      return
    }
    const t0 = performance.now()
    const loop = (t: number) => {
      const elapsed = ((t - t0) / 1000) * animSpeed
      if (t - lastAnimTick.current >= 48) {
        lastAnimTick.current = t
        setPhase(elapsed % 1)
      }
      animFrame.current = requestAnimationFrame(loop)
    }
    animFrame.current = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(animFrame.current)
      setPhase(0)
    }
  }, [animActive, animSpeed])

  const resolvedAnimMode: AnimationMode =
    !solarizeEnabled && animMode === 'solarize' ? 'hue' : animMode

  const asciiResult: AsciiResult | null = useMemo(() => {
    if (!asciiBitmap) return null
    return buildAscii(asciiBitmap, asciiBitmap.width, asciiBitmap.height, {
      columns,
      charset,
      rampInvert,
      grayscaleMode,
      imageInvert,
      solarizeEnabled,
      solarizeThreshold,
      blurPasses,
      sharpenAmount,
      edgeEmphasis,
      useColor,
      grayscaleGlyphHex: grayscaleGlyphColor,
      colorSaturation: useColor ? colorSaturationPct / 100 : 1,
      animationPhase: phase,
      animationMode: animEnabled ? resolvedAnimMode : null,
      alphaMatteHex: asciiBackground,
      grayscaleHueTintEnabled: !useColor && grayscaleHueTintEnabled,
      grayscaleHueTintDeg,
      grayscaleHueTintSaturation: grayscaleHueTintSaturationPct / 100,
    })
  }, [
    asciiBitmap,
    columns,
    charset,
    rampInvert,
    grayscaleMode,
    imageInvert,
    solarizeEnabled,
    solarizeThreshold,
    blurPasses,
    sharpenAmount,
    edgeEmphasis,
    useColor,
    grayscaleGlyphColor,
    colorSaturationPct,
    phase,
    animEnabled,
    resolvedAnimMode,
    asciiBackground,
    useColor,
    grayscaleHueTintEnabled,
    grayscaleHueTintDeg,
    grayscaleHueTintSaturationPct,
  ])

  const plainText = asciiResult?.plainText ?? ''
  const disabled = !sourceBitmap

  const asciiFitRevision = useMemo(
    () =>
      [
        asciiResult?.cols ?? 0,
        asciiResult?.rows ?? 0,
        plainText.length,
        columns,
        useColor ? 1 : 0,
        charset,
        overlayOnImage ? 1 : 0,
        asciiBitmap?.width ?? 0,
        asciiBitmap?.height ?? 0,
        nobgReady ? 1 : 0,
        asciiBackground,
      ].join('\u001e'),
    [
      asciiResult?.cols,
      asciiResult?.rows,
      plainText.length,
      columns,
      useColor,
      charset,
      overlayOnImage,
      asciiBitmap?.width,
      asciiBitmap?.height,
      nobgReady,
      asciiBackground,
    ]
  )

  const presetValue = useMemo(() => {
    const p = CHARSET_PRESETS.find((x) => x.value === charset)
    return p?.label ?? 'Custom'
  }, [charset])

  const onFile = useCallback((f: File | null) => {
    setFile(f)
    setNobgFile(null)
    setOverlayPhotoGrayscale(false)
    setOverlayPhotoOpacity(100)
    setOverlayPhotoHueDeg(0)
    setCopyState('idle')
    setBgRemoveError(null)
  }, [])

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      const next = f && f.type.startsWith('image/') ? f : null
      onFile(next)
      if (next) setAppScreen('workspace')
    },
    [onFile]
  )

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    const next = f && f.type.startsWith('image/') ? f : null
    onFile(next)
    if (next) setAppScreen('workspace')
  }, [onFile])

  const copy = useCallback(async () => {
    if (!plainText) return
    try {
      await navigator.clipboard.writeText(plainText)
      setCopyState('ok')
      window.setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('err')
      window.setTimeout(() => setCopyState('idle'), 2500)
    }
  }, [plainText])

  const downloadTxt = useCallback(() => {
    if (!plainText) return
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (file?.name.replace(/\.[^.]+$/, '') ?? 'ascii') + '.txt'
    a.click()
    URL.revokeObjectURL(a.href)
    setExportOpen(false)
  }, [plainText, file?.name])

  const downloadSvg = useCallback(
    (animated: boolean) => {
      if (!asciiResult) return
      const overlayActive =
        overlayOnImage && !animated && sourceBitmap != null
      let svg: string
      let suffix = ''
      if (overlayActive && sourceBitmap) {
        const imageDataUrl = bitmapToPngDataUrl(sourceBitmap, {
          photoGrayscale: overlayPhotoGrayscale,
          photoOpacityPct: overlayPhotoOpacity,
          photoHueDeg: overlayPhotoHueDeg,
        })
        if (!imageDataUrl) return
        svg = asciiOverlayToSvg(asciiResult, {
          imageDataUrl,
          width: sourceBitmap.width,
          height: sourceBitmap.height,
        })
        suffix = '-overlay'
      } else {
        svg = asciiResultToSvg(asciiResult, {
          fontSize: 10,
          lineHeight: 11,
          charAdvanceEm: 0.62,
          background: asciiBackground,
          animated,
        })
        suffix = animated ? '-animated' : ''
      }
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download =
        (file?.name.replace(/\.[^.]+$/, '') ?? 'ascii') + suffix + '.svg'
      a.click()
      URL.revokeObjectURL(a.href)
      setExportOpen(false)
    },
    [
      asciiResult,
      asciiBackground,
      file?.name,
      overlayOnImage,
      sourceBitmap,
      overlayPhotoGrayscale,
      overlayPhotoOpacity,
      overlayPhotoHueDeg,
    ]
  )

  const downloadPng = useCallback(async () => {
    if (!asciiResult?.plainText) return
    const overlayActive = overlayOnImage && sourceBitmap != null
    const blob = overlayActive && sourceBitmap
      ? await asciiOverlayToPngBlob(asciiResult, {
          bitmap: sourceBitmap,
          photoGrayscale: overlayPhotoGrayscale,
          photoOpacityPct: overlayPhotoOpacity,
          photoHueDeg: overlayPhotoHueDeg,
          pixelRatio: 2,
        })
      : await asciiResultToPngBlob(asciiResult, {
          background: asciiBackground,
          fontSize: 14,
          pixelRatio: 2,
        })
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download =
      (file?.name.replace(/\.[^.]+$/, '') ?? 'ascii') +
      (overlayActive ? '-overlay' : '') +
      '.png'
    a.click()
    URL.revokeObjectURL(a.href)
    setExportOpen(false)
  }, [
    asciiResult,
    asciiBackground,
    file?.name,
    overlayOnImage,
    sourceBitmap,
    overlayPhotoGrayscale,
    overlayPhotoOpacity,
    overlayPhotoHueDeg,
  ])

  const removeImageBackground = useCallback(async () => {
    if (!file || bgRemoveBusy) return
    setBgRemoveError(null)
    setBgRemoveBusy(true)
    try {
      // @imgly/background-removal runs entirely in the browser; the image is not uploaded.
      // Network requests (if any) fetch wasm/ONNX weights from the configured publicPath only.
      const { removeBackground } = await import('@imgly/background-removal')
      const blob = await removeBackground(file, {
        model: 'isnet_quint8',
        output: { format: 'image/png' },
      })
      const stem = file.name.replace(/\.[^.]+$/, '') || 'image'
      setNobgFile(
        new File([blob], `${stem}-nobg.png`, {
          type: 'image/png',
          lastModified: Date.now(),
        })
      )
    } catch (e) {
      setBgRemoveError(
        e instanceof Error ? e.message : 'Could not remove background'
      )
    } finally {
      setBgRemoveBusy(false)
    }
  }, [file, bgRemoveBusy])

  const captureCurrentSettings = useCallback(
    (): PresetSettings => ({
      columns,
      charset,
      rampInvert,
      grayscaleMode,
      imageInvert,
      solarizeEnabled,
      solarizeThreshold,
      blurPasses,
      sharpenAmount,
      edgeEmphasis,
      useColor,
      colorSaturationPct,
      animEnabled,
      animMode,
      animSpeed,
      asciiBackground,
      grayscaleGlyphColor,
      overlayOnImage,
      overlayPhotoGrayscale,
      overlayPhotoOpacity,
      overlayPhotoHueDeg,
      grayscaleHueTintEnabled,
      grayscaleHueTintDeg,
      grayscaleHueTintSaturationPct,
    }),
    [
      columns,
      charset,
      rampInvert,
      grayscaleMode,
      imageInvert,
      solarizeEnabled,
      solarizeThreshold,
      blurPasses,
      sharpenAmount,
      edgeEmphasis,
      useColor,
      colorSaturationPct,
      animEnabled,
      animMode,
      animSpeed,
      asciiBackground,
      grayscaleGlyphColor,
      overlayOnImage,
      overlayPhotoGrayscale,
      overlayPhotoOpacity,
      overlayPhotoHueDeg,
      grayscaleHueTintEnabled,
      grayscaleHueTintDeg,
      grayscaleHueTintSaturationPct,
    ]
  )

  const saveCurrentAsPreset = useCallback(() => {
    const trimmed = newPresetName.trim()
    const fallback = `Preset ${presets.length + 1}`
    const preset: SettingsPreset = {
      id: createPresetId(),
      name: (trimmed || fallback).slice(0, 60),
      createdAt: Date.now(),
      settings: captureCurrentSettings(),
    }
    setPresets((prev) => [preset, ...prev])
    setNewPresetName('')
    setPresetSavedFlash(true)
    window.setTimeout(() => setPresetSavedFlash(false), 1400)
  }, [newPresetName, presets.length, captureCurrentSettings])

  const applyPreset = useCallback((preset: SettingsPreset) => {
    const s = preset.settings
    setColumns(s.columns)
    setCharset(s.charset)
    setRampInvert(s.rampInvert)
    setGrayscaleMode(s.grayscaleMode)
    setImageInvert(s.imageInvert)
    setSolarizeEnabled(s.solarizeEnabled)
    setSolarizeThreshold(s.solarizeThreshold)
    setBlurPasses(s.blurPasses)
    setSharpenAmount(s.sharpenAmount)
    setEdgeEmphasis(s.edgeEmphasis)
    setUseColor(s.useColor)
    setColorSaturationPct(s.colorSaturationPct)
    setAnimEnabled(s.animEnabled)
    setAnimMode(s.animMode)
    setAnimSpeed(s.animSpeed)
    setAsciiBackground(s.asciiBackground)
    setGrayscaleGlyphColor(s.grayscaleGlyphColor)
    setOverlayOnImage(s.overlayOnImage)
    setOverlayPhotoGrayscale(
      typeof s.overlayPhotoGrayscale === 'boolean'
        ? s.overlayPhotoGrayscale
        : false
    )
    setOverlayPhotoOpacity(
      typeof s.overlayPhotoOpacity === 'number'
        ? clampNum(s.overlayPhotoOpacity, 0, 100)
        : 100
    )
    setOverlayPhotoHueDeg(
      typeof s.overlayPhotoHueDeg === 'number'
        ? clampNum(s.overlayPhotoHueDeg, 0, 360)
        : 0
    )
    setGrayscaleHueTintEnabled(
      typeof s.grayscaleHueTintEnabled === 'boolean'
        ? s.grayscaleHueTintEnabled
        : false
    )
    setGrayscaleHueTintDeg(
      typeof s.grayscaleHueTintDeg === 'number'
        ? clampNum(s.grayscaleHueTintDeg, 0, 360)
        : 0
    )
    setGrayscaleHueTintSaturationPct(
      typeof s.grayscaleHueTintSaturationPct === 'number'
        ? clampNum(s.grayscaleHueTintSaturationPct, 5, 100)
        : 62
    )
    setPresetsOpen(false)
  }, [])

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const randomizeSettings = useCallback(() => {
    setExportOpen(false)
    setCopyState('idle')
    setNobgFile(null)
    setOverlayPhotoGrayscale(randBool())
    setColumns(randInt(40, 500))
    setCharset(randomCharsetString())
    setRampInvert(randBool())
    setGrayscaleMode(GRAYSCALE_MODES[randInt(0, GRAYSCALE_MODES.length - 1)]!)
    setImageInvert(randBool())
    setSolarizeEnabled(randBool())
    setSolarizeThreshold(randInt(0, 255))
    setBlurPasses(randInt(0, 8))
    setSharpenAmount(randInt(0, 300) / 100)
    setEdgeEmphasis(randInt(0, 100) / 100)
    setUseColor(randBool())
    setColorSaturationPct(randInt(100, 250))
    setAnimMode(ANIM_MODES[randInt(0, ANIM_MODES.length - 1)]!)
    setAnimSpeed(randInt(20, 300) / 100)
    const { bg, glyph } = randomContrastingBgAndGlyph()
    setAsciiBackground(bg)
    setGrayscaleGlyphColor(glyph)
    setOverlayOnImage(randBool())
  }, [])

  const goHome = useCallback(() => {
    setAppScreen('home')
    setExportOpen(false)
    setPresetsOpen(false)
    setCopyState('idle')
    onFile(null)
  }, [onFile])

  const handleRailRandomize = useCallback(() => {
    setDiceSpinning(true)
    randomizeSettings()
  }, [randomizeSettings])

  const animModeLabel: Record<AnimationMode, string> = {
    hue: 'hue drift',
    ramp: 'ramp drift',
    solarize: 'solarize sweep',
    sharpen: 'sharpen pulse',
    edge: 'edge emphasis pulse',
    blur: 'blur pulse',
  }

  const grayscaleLabel: Record<GrayscaleMode, string> = {
    luminance: 'luminance',
    average: 'average',
    lightness: 'lightness',
    red: 'red channel',
    green: 'green channel',
    blue: 'blue channel',
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="visually-hidden"
        onChange={onInputChange}
        aria-label="Choose image file"
      />

      {appScreen === 'home' ? (
        <HomeScreen
          onPickAscii={() => setAppScreen('workspace')}
          onPickEightbit={() => setAppScreen('eightbit')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        />
      ) : appScreen === 'eightbit' ? (
        <EightBitTool onBackHome={() => setAppScreen('home')} />
      ) : (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <SidebarBrand onLogoClick={goHome} />
          {sourceBitmap && previewUrl && (
            <>
              <div className="sidebar-image-block">
                <div className="sidebar-thumb">
                  <img src={previewUrl} alt="" />
                </div>
                <div className="sidebar-image-actions">
                  <button
                    type="button"
                    className="sidebar-chip-btn"
                    aria-label="Replace image"
                    onClick={() => fileRef.current?.click()}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="sidebar-chip-btn"
                    aria-label="Remove background for ASCII only (original photo unchanged). Processing stays in your browser."
                    disabled={!file || bgRemoveBusy}
                    onClick={() => void removeImageBackground()}
                  >
                    {bgRemoveBusy ? 'Removing…' : 'Remove background'}
                  </button>
                </div>
              </div>
              {bgRemoveError && (
                <p className="sidebar-action-error" role="alert">
                  {bgRemoveError}
                </p>
              )}
            </>
          )}
        </div>

        <div className="sidebar-body">
          <div className="section">
            <RangeRow
              label="output size"
              valueLabel={String(columns)}
              min={40}
              max={500}
              value={columns}
              onChange={setColumns}
              disabled={disabled}
            />
            <label className="rich-check">
              <input
                type="checkbox"
                checked={overlayOnImage}
                disabled={disabled}
                onChange={(e) => {
                  const on = e.target.checked
                  setOverlayOnImage(on)
                  if (!on) {
                    setOverlayPhotoGrayscale(false)
                    setOverlayPhotoOpacity(100)
                    setOverlayPhotoHueDeg(0)
                  }
                }}
              />
              <span>overlay on image</span>
              <InfoTip label="Draws the ASCII grid on top of your source image in the preview. Each character lines up with the same pixels the converter samples." />
            </label>
            <label className="rich-check">
              <input
                type="checkbox"
                checked={overlayPhotoGrayscale}
                disabled={disabled || !overlayOnImage}
                onChange={(e) => {
                  const on = e.target.checked
                  setOverlayPhotoGrayscale(on)
                  if (!on) setOverlayPhotoHueDeg(0)
                }}
              />
              <span>{'B&W underlay'}</span>
              <InfoTip label="When overlay is on, shows the photo in greyscale under the ASCII so glyphs stand out more." />
            </label>
            <RangeRow
              label="underlay opacity"
              valueLabel={`${overlayPhotoOpacity}%`}
              min={0}
              max={100}
              value={overlayPhotoOpacity}
              onChange={setOverlayPhotoOpacity}
              disabled={disabled || !overlayOnImage}
            />
            <RangeRow
              label="B&W tint (hue)"
              valueLabel={`${overlayPhotoHueDeg}°`}
              min={0}
              max={360}
              step={5}
              value={overlayPhotoHueDeg}
              onChange={setOverlayPhotoHueDeg}
              disabled={disabled || !overlayOnImage || !overlayPhotoGrayscale}
            />
          </div>

          <div className="section section--pad-y">
            <p
              className={`section-label${disabled ? ' section-label--disabled' : ''}`}
            >
              characters
            </p>
            <div className="select-wrap">
              <Combobox
                value={presetValue}
                disabled={disabled}
                ariaLabel="Character preset"
                options={[
                  ...CHARSET_PRESETS.map((p) => ({
                    value: p.label,
                    label: p.label.toLowerCase(),
                  })),
                  { value: 'Custom', label: 'custom' },
                ]}
                onChange={(v) => {
                  if (v === 'Custom') {
                    setCharset('')
                    requestAnimationFrame(() =>
                      charsetTextareaRef.current?.focus()
                    )
                    return
                  }
                  const p = CHARSET_PRESETS.find((x) => x.label === v)
                  if (p) setCharset(p.value)
                }}
              />
            </div>
            <textarea
              ref={charsetTextareaRef}
              className="textarea"
              rows={3}
              value={charset}
              onChange={(e) => setCharset(e.target.value)}
              placeholder="Type your ramp, one character at a time…"
              spellCheck={false}
              disabled={disabled}
            />
            <label className="rich-check">
              <input
                type="checkbox"
                checked={rampInvert}
                disabled={disabled}
                onChange={(e) => setRampInvert(e.target.checked)}
              />
              <span>invert ramp</span>
              <InfoTip label="Reverses how your character ramp is applied: bright areas use dark glyphs and dark areas use light glyphs." />
            </label>
          </div>

          <div className="section section--pad-y">
            <p
              className={`section-label${disabled ? ' section-label--disabled' : ''}`}
            >
              grayscale mode
            </p>
            <Combobox<GrayscaleMode>
              value={grayscaleMode}
              disabled={disabled}
              ariaLabel="Grayscale mode"
              options={(Object.keys(grayscaleLabel) as GrayscaleMode[]).map(
                (k) => ({ value: k, label: grayscaleLabel[k] })
              )}
              onChange={(v) => setGrayscaleMode(v)}
            />
            <label className="rich-check">
              <input
                type="checkbox"
                checked={imageInvert}
                disabled={disabled}
                onChange={(e) => setImageInvert(e.target.checked)}
              />
              <span>invert image</span>
              <InfoTip label="Flips the source image brightness (like a negative) before blur, edge emphasis, and solarise run, so light and dark are swapped at the source." />
            </label>
            <label className="rich-check">
              <input
                type="checkbox"
                checked={solarizeEnabled}
                disabled={disabled}
                onChange={(e) => {
                  const on = e.target.checked
                  setSolarizeEnabled(on)
                  if (!on && animMode === 'solarize') setAnimMode('hue')
                }}
              />
              <span>solarise</span>
              <InfoTip label="Splits tones at a threshold: pixels brighter than it flip to their opposite value (Sabattier-style). Use the threshold slider to move where that split happens." />
            </label>
            {solarizeEnabled && (
              <RangeRow
                label="solarise threshold"
                valueLabel={String(solarizeThreshold)}
                min={0}
                max={255}
                value={solarizeThreshold}
                onChange={setSolarizeThreshold}
                disabled={disabled}
              />
            )}
          </div>

          <div className="section section--pad-y">
            <RangeRow
              label="colour saturation"
              valueLabel={`${colorSaturationPct}%`}
              min={100}
              max={250}
              value={colorSaturationPct}
              onChange={setColorSaturationPct}
              disabled={disabled || !useColor}
            />
            <label className="rich-check">
              <input
                type="checkbox"
                checked={grayscaleHueTintEnabled}
                disabled={disabled || useColor}
                onChange={(e) => setGrayscaleHueTintEnabled(e.target.checked)}
              />
              <span>greyscale hue tint</span>
              <InfoTip label="When ASCII is in greyscale (not full colour), colours each glyph from your chosen hue and saturation while lightness still follows the tone ramp." />
            </label>
            <RangeRow
              label="tint hue"
              valueLabel={`${grayscaleHueTintDeg}°`}
              min={0}
              max={360}
              step={5}
              value={grayscaleHueTintDeg}
              onChange={setGrayscaleHueTintDeg}
              disabled={disabled || useColor || !grayscaleHueTintEnabled}
            />
            <RangeRow
              label="tint saturation"
              valueLabel={`${grayscaleHueTintSaturationPct}%`}
              min={5}
              max={100}
              value={grayscaleHueTintSaturationPct}
              onChange={setGrayscaleHueTintSaturationPct}
              disabled={disabled || useColor || !grayscaleHueTintEnabled}
            />
          </div>

          <div className="section section--pad-y">
            <RangeRow
              label="blur"
              valueLabel={String(blurPasses)}
              min={0}
              max={8}
              value={blurPasses}
              onChange={setBlurPasses}
              disabled={disabled}
            />
            <RangeRow
              label="edge emphasis"
              valueLabel={`${Math.round(edgeEmphasis * 100)}%`}
              min={0}
              max={100}
              value={Math.round(edgeEmphasis * 100)}
              onChange={(n) => setEdgeEmphasis(n / 100)}
              disabled={disabled}
            />
            <RangeRow
              label="sharpen"
              valueLabel={sharpenAmount.toFixed(2)}
              min={0}
              max={300}
              value={Math.round(sharpenAmount * 100)}
              onChange={(n) => setSharpenAmount(n / 100)}
              disabled={disabled}
            />
          </div>

          <div className="section section--pad-y">
            <p
              className={`section-label${disabled ? ' section-label--disabled' : ''}`}
            >
              animations
            </p>
            <div className="switch-row">
              <button
                type="button"
                className="switch"
                role="switch"
                aria-checked={animEnabled}
                disabled={disabled}
                onClick={() => setAnimEnabled((v) => !v)}
              />
              <span>animate</span>
            </div>
            <Combobox<AnimationMode>
              value={animEnabled ? resolvedAnimMode : animMode}
              disabled={disabled || !animEnabled}
              ariaLabel="Animation mode"
              options={ANIM_MODES.filter(
                (m) => m !== 'solarize' || solarizeEnabled
              ).map((k) => ({ value: k, label: animModeLabel[k] }))}
              onChange={(v) => setAnimMode(v)}
            />
            <RangeRow
              label="speed"
              valueLabel={String(Math.round(animSpeed * 100))}
              min={20}
              max={300}
              value={Math.round(animSpeed * 100)}
              onChange={(n) => setAnimSpeed(n / 100)}
              disabled={disabled || !animEnabled}
            />
          </div>
        </div>
      </aside>

      <main
        className="workspace"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div className="workspace-inner">
          {!sourceBitmap ? (
            <button
              type="button"
              className="drop-hero"
              onClick={() => fileRef.current?.click()}
            >
              <div className="drop-hero-inner">
                <img
                  className="drop-hero-art"
                  src={horseAscii}
                  alt=""
                  aria-hidden
                  draggable={false}
                />
                <p className="drop-hero-caption">drop or upload image</p>
              </div>
            </button>
          ) : (
            <div
              className="ascii-stage"
              style={{
                backgroundColor: asciiBackground,
                color: useColor ? undefined : grayscaleGlyphColor,
              }}
            >
              <AsciiViewportFit
                key={asciiFitRevision}
                revision={asciiFitRevision}
              >
                {overlayOnImage && previewUrl && asciiResult && sourceBitmap ? (
                  <AsciiImageOverlay
                    bitmap={sourceBitmap}
                    previewUrl={previewUrl}
                    asciiResult={asciiResult}
                    photoGrayscale={overlayPhotoGrayscale}
                    photoOpacityPct={overlayPhotoOpacity}
                    photoHueDeg={overlayPhotoHueDeg}
                  />
                ) : (useColor || grayscaleHueTintEnabled) && asciiResult ? (
                  <div className="ascii ascii--color" aria-live="polite">
                    {asciiResult.lines.map((row, yi) => (
                      <div className="ascii-line" key={yi}>
                        {row.map((cell, xi) => (
                          <span key={`${yi}-${xi}`} style={{ color: cell.color }}>
                            {cell.ch}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="ascii" aria-live="polite">
                    {plainText}
                  </pre>
                )}
              </AsciiViewportFit>
            </div>
          )}
        </div>
      </main>

      <div className="right-rail">
        <div className="icon-dock" aria-label="Preview actions">
          <RailTip tip="Roll the design">
            <button
              type="button"
              className={`icon-btn${diceSpinning ? ' is-spinning' : ''}`}
              aria-label="Roll the design"
              onClick={handleRailRandomize}
              onAnimationEnd={() => setDiceSpinning(false)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M4 10a8 8 0 0 1 8-8v4l3-3-3-3M20 14a8 8 0 0 1-8 8v-4l-3 3 3 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </RailTip>

          <RailTip tip="Background colour">
            <label className="icon-btn icon-swatch">
              <input
                type="color"
                value={asciiBackground}
                onChange={(e) => setAsciiBackground(e.target.value)}
                aria-label="Set background colour"
              />
              <span
                className="swatch-visual"
                style={{ backgroundColor: asciiBackground }}
              />
            </label>
          </RailTip>

          <RailTip
            tip={useColor ? 'Switch to grayscale' : 'Switch to colour'}
          >
            <button
              type="button"
              className="icon-btn"
              aria-label={
                useColor
                  ? 'Use grayscale ASCII (tone ramp)'
                  : 'Use colour ASCII'
              }
              aria-pressed={useColor}
              disabled={!sourceBitmap}
              onClick={() => setUseColor((v) => !v)}
            >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <defs>
                <linearGradient
                  id={`${railGradId}-split`}
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="0"
                >
                  <stop offset="0%" stopColor="#f97316" />
                  <stop offset="50%" stopColor="#eab308" />
                  <stop offset="100%" stopColor="#3b82f6" />
                </linearGradient>
                <clipPath id={`${railGradId}-left`}>
                  <rect x="4" y="5" width="8" height="14" />
                </clipPath>
                <clipPath id={`${railGradId}-right`}>
                  <rect x="12" y="5" width="8" height="14" />
                </clipPath>
              </defs>
              <circle
                cx="12"
                cy="12"
                r="7"
                fill="#a3a3a3"
                clipPath={`url(#${railGradId}-left)`}
              />
              <circle
                cx="12"
                cy="12"
                r="7"
                fill={`url(#${railGradId}-split)`}
                clipPath={`url(#${railGradId}-right)`}
              />
              <circle
                cx="12"
                cy="12"
                r="7"
                stroke="currentColor"
                strokeWidth="1.25"
                fill="none"
              />
            </svg>
            </button>
          </RailTip>

          <RailTip
            tip={
              useColor
                ? 'Character colour'
                : grayscaleHueTintEnabled
                  ? 'Flat character colour (turn off greyscale hue tint to use)'
                  : 'Character colour'
            }
          >
            <label
              className={`icon-btn icon-swatch${useColor || grayscaleHueTintEnabled ? ' is-disabled' : ''}`}
            >
              <input
                type="color"
                value={grayscaleGlyphColor}
                disabled={useColor || grayscaleHueTintEnabled}
                onChange={(e) => setGrayscaleGlyphColor(e.target.value)}
                aria-label="Set ASCII character colour (grayscale mode)"
              />
              <span
                className="swatch-visual"
                style={{ backgroundColor: grayscaleGlyphColor }}
              />
            </label>
          </RailTip>

          <div className="rail-pop" ref={presetsRef}>
            <RailTip tip="Presets">
              <button
                type="button"
                className="icon-btn"
                aria-expanded={presetsOpen}
                aria-haspopup="true"
                aria-label="Save and apply settings presets"
                onClick={() => setPresetsOpen((o) => !o)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M6.5 3.75h11a1 1 0 0 1 1 1V20a.5.5 0 0 1-.79.41L12 16.5l-5.71 3.91A.5.5 0 0 1 5.5 20V4.75a1 1 0 0 1 1-1Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </RailTip>
            {presetsOpen && (
              <div className="rail-menu rail-menu--presets" role="dialog" aria-label="Presets">
                <form
                  className="presets-save"
                  onSubmit={(e) => {
                    e.preventDefault()
                    saveCurrentAsPreset()
                  }}
                >
                  <input
                    ref={presetNameInputRef}
                    type="text"
                    className="presets-input"
                    placeholder="Name this preset"
                    maxLength={60}
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    aria-label="Preset name"
                  />
                  <button
                    type="submit"
                    className="presets-save-btn"
                    aria-label="Save current settings as a preset"
                  >
                    {presetSavedFlash ? 'Saved' : 'Save'}
                  </button>
                </form>
                <p className="presets-hint">
                  Stored locally in your browser. Image is not saved.
                </p>
                <div className="presets-divider" role="presentation" />
                {presets.length === 0 ? (
                  <p className="presets-empty">No presets yet.</p>
                ) : (
                  <ul className="presets-list" role="list">
                    {presets.map((p) => (
                      <li key={p.id} className="presets-row">
                        <button
                          type="button"
                          className="presets-apply"
                          onClick={() => applyPreset(p)}
                          title="Apply this preset"
                        >
                          <span className="presets-row-name">{p.name}</span>
                        </button>
                        <button
                          type="button"
                          className="presets-delete"
                          onClick={() => deletePreset(p.id)}
                          aria-label={`Delete preset ${p.name}`}
                          title="Delete preset"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path
                              d="M6 6l12 12M18 6L6 18"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="export-pop" ref={exportRef}>
            <RailTip tip="Export">
              <button
                type="button"
                className="icon-btn"
                aria-expanded={exportOpen}
                aria-haspopup="true"
                disabled={!asciiResult?.plainText}
                onClick={() => setExportOpen((o) => !o)}
                aria-label="Export menu"
              >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3v12M8 11l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M5 19h14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              </button>
            </RailTip>
            {exportOpen && (
              <div className="export-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!plainText}
                  onClick={() => void copy()}
                >
                  {copyState === 'ok'
                    ? 'Copied'
                    : copyState === 'err'
                      ? 'Copy failed'
                      : 'Copy text'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!plainText}
                  onClick={downloadTxt}
                >
                  Download .txt
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!asciiResult?.plainText}
                  onClick={() => downloadSvg(false)}
                >
                  Download SVG
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!asciiResult?.plainText || overlayOnImage}
                  onClick={() => downloadSvg(true)}
                  title={
                    overlayOnImage
                      ? 'Turn off overlay on image to export an animated SVG'
                      : undefined
                  }
                >
                  Download SVG (animated)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!asciiResult?.plainText}
                  onClick={() => void downloadPng()}
                >
                  Download PNG
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
      )}
    </>
  )
}
