import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import type { GrayscaleMode } from '../asciiPipeline'
import {
  buildHalftone,
  halftoneToPngBlob,
  type HalftoneDotModel,
  type HalftoneResult,
} from '../halftonePipeline'
import horseAscii from '../assets/horse-ascii.png'
import '../App.css'
import {
  AsciiViewportFit,
  Combobox,
  InfoTip,
  RailTip,
  RangeRow,
  TooltipSpan,
  ToolBrandHomeLink,
  useImageBitmap,
} from '../toolUi'

const PRIVACY_NOTE =
  'Photos stay in your browser: we do not upload or store them. Remove background runs locally; only ML model files may download from the vendor CDN, not your image.'

const GRAYSCALE_MODES: GrayscaleMode[] = [
  'luminance',
  'average',
  'lightness',
  'red',
  'green',
  'blue',
]

const LAYER_INK_DEFAULTS: Record<number, string[]> = {
  1: ['#1a1a1a'],
  2: ['#c41e3a', '#284ea0'],
  3: ['#dc2030', '#ffdc10', '#1e3ac6'],
  4: ['#00a8cc', '#e63976', '#ffd23f', '#1d1d1d'],
  5: ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#e9c46a'],
}

function defaultInksForLayerCount(n: number): string[] {
  const k = Math.max(1, Math.min(5, Math.round(n)))
  return [...(LAYER_INK_DEFAULTS[k] ?? LAYER_INK_DEFAULTS[3]!)]
}

type LayerCountStr = '1' | '2' | '3' | '4' | '5'

type HalftonePresetSettings = {
  columns: number
  pixelsPerCell: number
  dotModel?: HalftoneDotModel | 'ryb'
  layeredChannelCount?: number
  layeredInkHexes?: string[]
  layerOffsetPct?: number
  rybOffsetPct?: number
  warpPct?: number
  warpFreq?: number
  dotMaxPct: number
  dotOpacityPct?: number
  contrastPct: number
  grayscaleMode: GrayscaleMode
  imageInvert: boolean
  solarizeEnabled: boolean
  solarizeThreshold: number
  blurPasses: number
  useColor: boolean
  colorSaturationPct: number
  inkHex: string
  animEnabled: boolean
  animSpeed: number
  stageBackground: string
  overlayOnImage: boolean
  exportScale: number
}

type HalftonePreset = {
  id: string
  name: string
  createdAt: number
  settings: HalftonePresetSettings
}

const HALFTONE_PRESETS_KEY = 'halftone-creator:presets:v1'

function isValidHalftonePreset(value: unknown): value is HalftonePreset {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || typeof v.name !== 'string') return false
  const s = v.settings as Record<string, unknown> | undefined
  if (!s || typeof s !== 'object') return false
  const dm = s.dotModel
  const okDm =
    dm === undefined ||
    dm === 'single' ||
    dm === 'layered' ||
    dm === 'ryb'
  const inks = s.layeredInkHexes
  const okInks =
    inks === undefined ||
    (Array.isArray(inks) && inks.every((h) => typeof h === 'string'))
  return (
    typeof s.columns === 'number' &&
    typeof s.pixelsPerCell === 'number' &&
    okDm &&
    okInks &&
    (typeof s.layeredChannelCount === 'number' ||
      s.layeredChannelCount === undefined) &&
    (typeof s.layerOffsetPct === 'number' || s.layerOffsetPct === undefined) &&
    (typeof s.rybOffsetPct === 'number' || s.rybOffsetPct === undefined) &&
    (typeof s.dotOpacityPct === 'number' || s.dotOpacityPct === undefined) &&
    (typeof s.warpPct === 'number' || s.warpPct === undefined) &&
    (typeof s.warpFreq === 'number' || s.warpFreq === undefined) &&
    typeof s.dotMaxPct === 'number' &&
    typeof s.contrastPct === 'number' &&
    GRAYSCALE_MODES.includes(s.grayscaleMode as GrayscaleMode) &&
    typeof s.imageInvert === 'boolean' &&
    typeof s.solarizeEnabled === 'boolean' &&
    typeof s.solarizeThreshold === 'number' &&
    typeof s.blurPasses === 'number' &&
    typeof s.useColor === 'boolean' &&
    typeof s.colorSaturationPct === 'number' &&
    typeof s.inkHex === 'string' &&
    typeof s.animEnabled === 'boolean' &&
    typeof s.animSpeed === 'number' &&
    typeof s.stageBackground === 'string' &&
    typeof s.overlayOnImage === 'boolean' &&
    typeof s.exportScale === 'number'
  )
}

function loadHalftonePresets(): HalftonePreset[] {
  try {
    const raw = localStorage.getItem(HALFTONE_PRESETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidHalftonePreset)
  } catch {
    return []
  }
}

function persistHalftonePresets(presets: HalftonePreset[]): void {
  try {
    localStorage.setItem(HALFTONE_PRESETS_KEY, JSON.stringify(presets))
  } catch {
    /* ignore */
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

function randomContrastingInk(paper: string): string {
  for (let i = 0; i < 48; i++) {
    const ink = randHexColor()
    if (contrastRatio(paper, ink) >= 3.5) return ink
  }
  const L = relativeLuminance(paper)
  return L > 0.5 ? '#0a0a0a' : '#f5f5f5'
}

function HalftoneOverlay({
  bitmap,
  previewUrl,
  result,
  photoGrayscale,
}: {
  bitmap: ImageBitmap
  previewUrl: string
  result: HalftoneResult
  photoGrayscale: boolean
}) {
  const bw = bitmap.width
  const bh = bitmap.height
  const { imageData, pixelsPerCell, cols, rows } = result
  const iw = cols * pixelsPerCell
  const ih = rows * pixelsPerCell
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = iw
    c.height = ih
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.putImageData(imageData, 0, 0)
  }, [imageData, iw, ih])

  return (
    <div className="ascii-overlay" style={{ width: bw, height: bh }}>
      <img
        className={`ascii-overlay__img${photoGrayscale ? ' ascii-overlay__img--bw' : ''}`}
        src={previewUrl}
        alt=""
        width={bw}
        height={bh}
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        className="halftone-overlay-canvas"
        width={iw}
        height={ih}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          imageRendering: 'pixelated',
          pointerEvents: 'none',
        }}
        aria-hidden
      />
    </div>
  )
}

function SidebarBrandHalftone({ onBackHome }: { onBackHome: () => void }) {
  return (
    <div className="sidebar-brand">
      <div className="sidebar-brand-logo-wrap">
        <ToolBrandHomeLink onPress={onBackHome} />
      </div>
      <div className="sidebar-brand-text">
        <div className="sidebar-brand-headline">
          <TooltipSpan
            kind="info"
            tip={PRIVACY_NOTE}
            className="info-tip-wrap privacy-tip-wrap"
          >
            <span className="privacy-headline-inner">
              <p className="sidebar-brand-title">halftone</p>
              <button type="button" className="info-btn" aria-label={PRIVACY_NOTE}>
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

const PREVIEW_TARGET_CSS_WIDTH = 480
const PREVIEW_MAX_CSS_HEIGHT = 680
const PREVIEW_CELL_SCALE_MIN = 1
const PREVIEW_CELL_SCALE_MAX = 48
const MAX_LAYER_OFFSET_PCT = 250

export function HalftoneTool({ onBackHome }: { onBackHome: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [columns, setColumns] = useState(100)
  const [pixelsPerCell, setPixelsPerCell] = useState(6)
  const [dotModel, setDotModel] = useState<HalftoneDotModel>('single')
  const [layerCount, setLayerCount] = useState(3)
  const [layerInkHexes, setLayerInkHexes] = useState<string[]>(() =>
    defaultInksForLayerCount(3)
  )
  const [layerOffsetPct, setLayerOffsetPct] = useState(58)
  const [warpPct, setWarpPct] = useState(8)
  const [warpFreq, setWarpFreq] = useState(3)
  const [dotMaxPct, setDotMaxPct] = useState(92)
  const [dotOpacityPct, setDotOpacityPct] = useState(100)
  const [contrastPct, setContrastPct] = useState(100)
  const [grayscaleMode, setGrayscaleMode] = useState<GrayscaleMode>('luminance')
  const [imageInvert, setImageInvert] = useState(false)
  const [solarizeEnabled, setSolarizeEnabled] = useState(false)
  const [solarizeThreshold, setSolarizeThreshold] = useState(128)
  const [blurPasses, setBlurPasses] = useState(0)
  const [useColor, setUseColor] = useState(true)
  const [colorSaturationPct, setColorSaturationPct] = useState(100)
  const [inkHex, setInkHex] = useState('#0a0a0a')
  const [animEnabled, setAnimEnabled] = useState(false)
  const [animSpeed, setAnimSpeed] = useState(1)
  const [phase, setPhase] = useState(0)
  const [stageBackground, setStageBackground] = useState('#ffffff')
  const [overlayOnImage, setOverlayOnImage] = useState(false)
  const [overlayPhotoGrayscale, setOverlayPhotoGrayscale] = useState(false)
  const [exportScale, setExportScale] = useState(2)
  const [exportOpen, setExportOpen] = useState(false)
  const [randSpinning, setRandSpinning] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [presets, setPresets] = useState<HalftonePreset[]>(() =>
    loadHalftonePresets()
  )
  const [newPresetName, setNewPresetName] = useState('')
  const [presetSavedFlash, setPresetSavedFlash] = useState(false)
  const [bgRemoveBusy, setBgRemoveBusy] = useState(false)
  const [bgRemoveError, setBgRemoveError] = useState<string | null>(null)
  const [nobgFile, setNobgFile] = useState<File | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const presetsRef = useRef<HTMLDivElement>(null)
  const presetNameInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const sourceBitmap = useImageBitmap(file)
  const nobgBitmap = useImageBitmap(nobgFile)
  const nobgReady = nobgFile != null && nobgBitmap != null
  const workBitmap = nobgReady ? nobgBitmap : sourceBitmap

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
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setPresetsOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [presetsOpen])

  useEffect(() => {
    persistHalftonePresets(presets)
  }, [presets])

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

  const halftoneResult: HalftoneResult | null = useMemo(() => {
    if (!workBitmap) return null
    return buildHalftone(workBitmap, workBitmap.width, workBitmap.height, {
      columns,
      pixelsPerCell,
      dotModel,
      dotMaxFrac: dotMaxPct / 100,
      dotOpacity: dotOpacityPct / 100,
      contrast: contrastPct / 100,
      grayscaleMode,
      imageInvert,
      solarizeEnabled,
      solarizeThreshold,
      blurPasses,
      useColor,
      colorSaturationPct,
      inkHex,
      paperHex: stageBackground,
      animationPhase: phase,
      animHueEnabled: animEnabled,
      alphaMatteHex: stageBackground,
      layeredChannelCount: dotModel === 'layered' ? layerCount : 1,
      layeredInkHexes:
        dotModel === 'layered'
          ? layerInkHexes.slice(0, layerCount)
          : [inkHex],
      layerMisregistration: layerOffsetPct / 100,
      warpStrengthPx: (warpPct / 100) * 10,
      warpFrequency: warpFreq,
    })
  }, [
    workBitmap,
    columns,
    pixelsPerCell,
    dotModel,
    layerCount,
    layerInkHexes,
    layerOffsetPct,
    warpPct,
    warpFreq,
    dotMaxPct,
    dotOpacityPct,
    contrastPct,
    grayscaleMode,
    imageInvert,
    solarizeEnabled,
    solarizeThreshold,
    blurPasses,
    useColor,
    colorSaturationPct,
    inkHex,
    phase,
    animEnabled,
    stageBackground,
  ])

  const iw = halftoneResult
    ? halftoneResult.cols * halftoneResult.pixelsPerCell
    : 0
  const ih = halftoneResult
    ? halftoneResult.rows * halftoneResult.pixelsPerCell
    : 0

  const previewCellScale = useMemo(() => {
    if (!halftoneResult || iw < 1 || ih < 1) return 2
    let s = Math.round(PREVIEW_TARGET_CSS_WIDTH / iw)
    if (ih * s > PREVIEW_MAX_CSS_HEIGHT) {
      s = Math.floor(PREVIEW_MAX_CSS_HEIGHT / ih)
    }
    return Math.max(
      PREVIEW_CELL_SCALE_MIN,
      Math.min(PREVIEW_CELL_SCALE_MAX, s)
    )
  }, [halftoneResult, iw, ih])

  const fitRevision = useMemo(
    () =>
      [
        iw,
        ih,
        columns,
        halftoneResult?.pixelsPerCell ?? 0,
        previewCellScale,
        overlayOnImage ? 1 : 0,
        workBitmap?.width ?? 0,
        workBitmap?.height ?? 0,
        stageBackground,
        dotModel,
        layerCount,
        layerInkHexes.join(','),
        layerOffsetPct,
        warpPct,
        warpFreq,
        dotMaxPct,
        dotOpacityPct,
      ].join('\u001e'),
    [
      iw,
      ih,
      columns,
      halftoneResult?.pixelsPerCell,
      previewCellScale,
      overlayOnImage,
      workBitmap?.width,
      workBitmap?.height,
      stageBackground,
      dotModel,
      layerCount,
      layerInkHexes,
      layerOffsetPct,
      warpPct,
      warpFreq,
      dotMaxPct,
      dotOpacityPct,
    ]
  )

  useLayoutEffect(() => {
    const c = canvasRef.current
    if (!c || !halftoneResult || overlayOnImage) return
    const { imageData } = halftoneResult
    const s = previewCellScale
    c.width = iw * s
    c.height = ih * s
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    const tmp = document.createElement('canvas')
    tmp.width = iw
    tmp.height = ih
    const tctx = tmp.getContext('2d')
    if (!tctx) return
    tctx.putImageData(imageData, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(tmp, 0, 0, iw, ih, 0, 0, iw * s, ih * s)
  }, [halftoneResult, overlayOnImage, previewCellScale, iw, ih])

  const disabled = !sourceBitmap

  const onFile = useCallback((f: File | null) => {
    setFile(f)
    setNobgFile(null)
    setOverlayPhotoGrayscale(false)
    setBgRemoveError(null)
  }, [])

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      onFile(f && f.type.startsWith('image/') ? f : null)
    },
    [onFile]
  )

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const f = e.dataTransfer.files?.[0]
      onFile(f && f.type.startsWith('image/') ? f : null)
    },
    [onFile]
  )

  const downloadPng = useCallback(async () => {
    if (!halftoneResult) return
    const blob = await halftoneToPngBlob(halftoneResult, {
      scale: exportScale,
      background: stageBackground,
      pixelRatio: 2,
    })
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (file?.name.replace(/\.[^.]+$/, '') ?? 'halftone') + '.png'
    a.click()
    URL.revokeObjectURL(a.href)
    setExportOpen(false)
  }, [halftoneResult, exportScale, stageBackground, file?.name])

  const removeImageBackground = useCallback(async () => {
    if (!file || bgRemoveBusy) return
    setBgRemoveError(null)
    setBgRemoveBusy(true)
    try {
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

  const captureSettings = useCallback(
    (): HalftonePresetSettings => ({
      columns,
      pixelsPerCell,
      dotModel,
      layeredChannelCount: layerCount,
      layeredInkHexes: layerInkHexes.slice(0, layerCount),
      layerOffsetPct,
      warpPct,
      warpFreq,
      dotMaxPct,
      dotOpacityPct,
      contrastPct,
      grayscaleMode,
      imageInvert,
      solarizeEnabled,
      solarizeThreshold,
      blurPasses,
      useColor,
      colorSaturationPct,
      inkHex,
      animEnabled,
      animSpeed,
      stageBackground,
      overlayOnImage,
      exportScale,
    }),
    [
      columns,
      pixelsPerCell,
      dotModel,
      layerCount,
      layerInkHexes,
      layerOffsetPct,
      warpPct,
      warpFreq,
      dotMaxPct,
      dotOpacityPct,
      contrastPct,
      grayscaleMode,
      imageInvert,
      solarizeEnabled,
      solarizeThreshold,
      blurPasses,
      useColor,
      colorSaturationPct,
      inkHex,
      animEnabled,
      animSpeed,
      stageBackground,
      overlayOnImage,
      exportScale,
    ]
  )

  const savePreset = useCallback(() => {
    const trimmed = newPresetName.trim()
    const fallback = `Preset ${presets.length + 1}`
    const preset: HalftonePreset = {
      id: createPresetId(),
      name: (trimmed || fallback).slice(0, 60),
      createdAt: Date.now(),
      settings: captureSettings(),
    }
    setPresets((prev) => [preset, ...prev])
    setNewPresetName('')
    setPresetSavedFlash(true)
    window.setTimeout(() => setPresetSavedFlash(false), 1400)
  }, [newPresetName, presets.length, captureSettings])

  const applyPreset = useCallback((p: HalftonePreset) => {
    const s = p.settings
    setColumns(s.columns)
    setPixelsPerCell(s.pixelsPerCell)
    const legacyRyb = s.dotModel === 'ryb'
    const dm: HalftoneDotModel =
      s.dotModel === 'layered' || legacyRyb ? 'layered' : 'single'
    setDotModel(dm)
    const offRaw =
      typeof s.layerOffsetPct === 'number'
        ? s.layerOffsetPct
        : typeof s.rybOffsetPct === 'number'
          ? s.rybOffsetPct
          : 58
    setLayerOffsetPct(
      Math.max(0, Math.min(MAX_LAYER_OFFSET_PCT, offRaw))
    )
    if (dm === 'layered') {
      const ncFromInks =
        Array.isArray(s.layeredInkHexes) && s.layeredInkHexes.length > 0
          ? Math.min(5, Math.max(1, s.layeredInkHexes.length))
          : undefined
      const ncRaw =
        typeof s.layeredChannelCount === 'number' &&
        !Number.isNaN(s.layeredChannelCount)
          ? s.layeredChannelCount
          : legacyRyb
            ? 3
            : ncFromInks ?? 3
      const nc = Math.max(1, Math.min(5, Math.round(ncRaw)))
      setLayerCount(nc)
      let inks =
        Array.isArray(s.layeredInkHexes) && s.layeredInkHexes.length > 0
          ? s.layeredInkHexes.filter((x): x is string => typeof x === 'string')
          : undefined
      if (!inks || inks.length === 0) {
        inks = defaultInksForLayerCount(nc)
      } else {
        inks = inks.slice(0, nc)
        const defs = defaultInksForLayerCount(nc)
        while (inks.length < nc) inks.push(defs[inks.length] ?? '#333333')
      }
      setLayerInkHexes(inks)
    } else {
      setLayerCount(3)
      setLayerInkHexes(defaultInksForLayerCount(3))
    }
    setWarpPct(
      typeof s.warpPct === 'number'
        ? Math.max(0, Math.min(100, s.warpPct))
        : 0
    )
    setWarpFreq(
      typeof s.warpFreq === 'number'
        ? Math.max(1, Math.min(10, s.warpFreq))
        : 3
    )
    setDotMaxPct(s.dotMaxPct)
    setDotOpacityPct(
      typeof s.dotOpacityPct === 'number'
        ? Math.max(0, Math.min(100, s.dotOpacityPct))
        : 100
    )
    setContrastPct(s.contrastPct)
    setGrayscaleMode(s.grayscaleMode)
    setImageInvert(s.imageInvert)
    setSolarizeEnabled(s.solarizeEnabled)
    setSolarizeThreshold(s.solarizeThreshold)
    setBlurPasses(s.blurPasses)
    setUseColor(s.useColor)
    setColorSaturationPct(s.colorSaturationPct)
    setInkHex(s.inkHex)
    setAnimEnabled(s.animEnabled)
    setAnimSpeed(s.animSpeed)
    setStageBackground(s.stageBackground)
    setOverlayOnImage(s.overlayOnImage)
    setExportScale(s.exportScale)
    setPresetsOpen(false)
  }, [])

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const randomizeSettings = useCallback(() => {
    setExportOpen(false)
    setNobgFile(null)
    setOverlayPhotoGrayscale(randBool())
    setColumns(randInt(48, 220))
    setPixelsPerCell(randInt(4, 11))
    const layered = randBool()
    setDotModel(layered ? 'layered' : 'single')
    if (layered) {
      const nc = randInt(1, 5)
      setLayerCount(nc)
      setLayerInkHexes(Array.from({ length: nc }, () => randHexColor()))
    } else {
      setLayerCount(3)
      setLayerInkHexes(defaultInksForLayerCount(3))
    }
    setLayerOffsetPct(randInt(20, MAX_LAYER_OFFSET_PCT))
    setWarpPct(randInt(0, 28))
    setWarpFreq(randInt(2, 8))
    setDotMaxPct(randInt(72, 100))
    setDotOpacityPct(randInt(35, 100))
    setContrastPct(randInt(70, 165))
    setGrayscaleMode(GRAYSCALE_MODES[randInt(0, GRAYSCALE_MODES.length - 1)]!)
    setImageInvert(randBool())
    setSolarizeEnabled(randBool())
    setSolarizeThreshold(randInt(0, 255))
    setBlurPasses(randInt(0, 4))
    setUseColor(randBool())
    setColorSaturationPct(randInt(80, 200))
    const paper = randHexColor()
    setStageBackground(paper)
    setInkHex(randomContrastingInk(paper))
    setAnimEnabled(randBool())
    setAnimSpeed(randInt(20, 280) / 100)
    setOverlayOnImage(randBool())
    setExportScale(randInt(1, 6))
  }, [])

  const grayscaleLabel: Record<GrayscaleMode, string> = {
    luminance: 'luminance',
    average: 'average',
    lightness: 'lightness',
    red: 'red channel',
    green: 'green channel',
    blue: 'blue channel',
  }

  const isLayered = dotModel === 'layered'

  const dotModelLabel: Record<HalftoneDotModel, string> = {
    single: 'single screen',
    layered: 'layered inks (riso)',
  }

  return (
    <div className="shell">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="visually-hidden"
        onChange={onInputChange}
        aria-label="Choose image file"
      />

      <aside className="sidebar">
        <div className="sidebar-top">
          <SidebarBrandHalftone onBackHome={onBackHome} />
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
              label="grid columns"
              valueLabel={String(columns)}
              min={32}
              max={320}
              value={columns}
              onChange={setColumns}
              disabled={disabled}
            />
            <RangeRow
              label="dot resolution"
              valueLabel={`${halftoneResult?.pixelsPerCell ?? pixelsPerCell}px`}
              min={2}
              max={14}
              value={pixelsPerCell}
              onChange={setPixelsPerCell}
              disabled={disabled}
            />
            <p className="presets-hint" style={{ marginTop: 2 }}>
              Higher values smooth dot edges; large grids auto-cap resolution for speed.
            </p>
            <label className="rich-check">
              <input
                type="checkbox"
                checked={overlayOnImage}
                disabled={disabled}
                onChange={(e) => {
                  const on = e.target.checked
                  setOverlayOnImage(on)
                  if (!on) setOverlayPhotoGrayscale(false)
                }}
              />
              <span>overlay on image</span>
              <InfoTip label="Draws the halftone layer on top of your source photo, scaled to match." />
            </label>
            {overlayOnImage && (
              <label className="rich-check">
                <input
                  type="checkbox"
                  checked={overlayPhotoGrayscale}
                  disabled={disabled}
                  onChange={(e) => setOverlayPhotoGrayscale(e.target.checked)}
                />
                <span>{'B&W underlay'}</span>
                <InfoTip label="Shows the photo in greyscale under the halftone layer." />
              </label>
            )}
          </div>

          <div className="section section--pad-y">
            <p className={`section-label${disabled ? ' section-label--disabled' : ''}`}>
              print style
            </p>
            <Combobox<HalftoneDotModel>
              value={dotModel}
              disabled={disabled}
              ariaLabel="Print style"
              options={(
                Object.keys(dotModelLabel) as HalftoneDotModel[]
              ).map((k) => ({
                value: k,
                label: dotModelLabel[k],
              }))}
              onChange={(v) => setDotModel(v)}
            />
            {isLayered && (
              <>
                <Combobox<LayerCountStr>
                  value={String(layerCount) as LayerCountStr}
                  disabled={disabled}
                  ariaLabel="Number of ink layers"
                  options={([1, 2, 3, 4, 5] as const).map((n) => ({
                    value: String(n) as LayerCountStr,
                    label: n === 1 ? '1 ink' : `${n} inks`,
                  }))}
                  onChange={(v) => {
                    const nn = Math.max(1, Math.min(5, Number(v)))
                    setLayerCount(nn)
                    setLayerInkHexes((prev) => {
                      const next = prev.slice(0, nn)
                      const defs = defaultInksForLayerCount(nn)
                      while (next.length < nn)
                        next.push(defs[next.length] ?? '#333333')
                      return next
                    })
                  }}
                />
                <div
                  className="layer-ink-list"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {Array.from({ length: layerCount }, (_, i) => (
                    <label
                      key={i}
                      className="layer-ink-row"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ minWidth: 56, opacity: 0.85 }}>
                        ink {i + 1}
                      </span>
                      <input
                        type="color"
                        value={layerInkHexes[i] ?? '#000000'}
                        disabled={disabled}
                        onChange={(e) => {
                          const hex = e.target.value
                          setLayerInkHexes((prev) => {
                            const copy = [...prev]
                            copy[i] = hex
                            return copy
                          })
                        }}
                        aria-label={`Ink ${i + 1} colour`}
                        style={{
                          width: 40,
                          height: 28,
                          padding: 0,
                          border: 'none',
                          cursor: disabled ? 'default' : 'pointer',
                        }}
                      />
                      <span
                        className="swatch-visual"
                        style={{
                          backgroundColor: layerInkHexes[i] ?? '#000000',
                          width: 28,
                          height: 28,
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                        aria-hidden
                      />
                    </label>
                  ))}
                </div>
                <RangeRow
                  label="screen offset"
                  valueLabel={`${layerOffsetPct}%`}
                  min={0}
                  max={MAX_LAYER_OFFSET_PCT}
                  value={layerOffsetPct}
                  onChange={setLayerOffsetPct}
                  disabled={disabled}
                />
                <p className="presets-hint" style={{ marginTop: 4 }}>
                  Each ink uses its own halftone screen, shifted and multiplied like riso
                  layers. Higher values push screens further apart (up to{' '}
                  {MAX_LAYER_OFFSET_PCT}%).
                </p>
              </>
            )}
            <RangeRow
              label="organic warp"
              valueLabel={`${warpPct}%`}
              min={0}
              max={100}
              value={warpPct}
              onChange={setWarpPct}
              disabled={disabled}
            />
            <RangeRow
              label="warp waves"
              valueLabel={String(warpFreq)}
              min={1}
              max={10}
              value={warpFreq}
              onChange={setWarpFreq}
              disabled={disabled}
            />
            <p className="presets-hint" style={{ marginTop: 2 }}>
              A light wave is sampled over the finished halftone (subtle misprint / paper
              buckle).
            </p>
          </div>

          <div className="section section--pad-y">
            <RangeRow
              label="max dot size"
              valueLabel={`${dotMaxPct}%`}
              min={40}
              max={100}
              value={dotMaxPct}
              onChange={setDotMaxPct}
              disabled={disabled}
            />
            <RangeRow
              label="dot opacity"
              valueLabel={`${dotOpacityPct}%`}
              min={0}
              max={100}
              value={dotOpacityPct}
              onChange={setDotOpacityPct}
              disabled={disabled}
            />
            <p className="presets-hint" style={{ marginTop: 2 }}>
              Blends printed dots toward the paper colour (single screen and layered inks).
            </p>
            <RangeRow
              label="contrast"
              valueLabel={`${contrastPct}%`}
              min={35}
              max={250}
              value={contrastPct}
              onChange={setContrastPct}
              disabled={disabled}
            />
            <p className="presets-hint" style={{ marginTop: 4 }}>
              Contrast stretches tones around mid grey before dots are sized (100% is neutral).
            </p>
          </div>

          <div className="section section--pad-y">
            <p className={`section-label${disabled ? ' section-label--disabled' : ''}`}>
              grayscale mode
            </p>
            <Combobox<GrayscaleMode>
              value={grayscaleMode}
              disabled={disabled}
              ariaLabel="Grayscale mode"
              options={(Object.keys(grayscaleLabel) as GrayscaleMode[]).map((k) => ({
                value: k,
                label: grayscaleLabel[k],
              }))}
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
              <InfoTip label="Flips source brightness before the halftone screen is applied." />
            </label>
            <label className="rich-check">
              <input
                type="checkbox"
                checked={solarizeEnabled}
                disabled={disabled}
                onChange={(e) => setSolarizeEnabled(e.target.checked)}
              />
              <span>solarise</span>
              <InfoTip label="Splits tones at a threshold before halftoning." />
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
              label="tone blur"
              valueLabel={String(blurPasses)}
              min={0}
              max={6}
              value={blurPasses}
              onChange={setBlurPasses}
              disabled={disabled}
            />
            {useColor && !isLayered && (
              <RangeRow
                label="colour saturation"
                valueLabel={`${colorSaturationPct}%`}
                min={100}
                max={250}
                value={colorSaturationPct}
                onChange={setColorSaturationPct}
                disabled={disabled}
              />
            )}
          </div>

          <div className="section section--pad-y">
            <p className={`section-label${disabled ? ' section-label--disabled' : ''}`}>
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
              <span>animate (hue)</span>
            </div>
            {animEnabled && (
              <RangeRow
                label="speed"
                valueLabel={String(Math.round(animSpeed * 100))}
                min={20}
                max={300}
                value={Math.round(animSpeed * 100)}
                onChange={(n: number) => setAnimSpeed(n / 100)}
                disabled={disabled}
              />
            )}
          </div>

          <div className="section section--pad-y">
            <RangeRow
              label="PNG pixel scale"
              valueLabel={`${exportScale}×`}
              min={1}
              max={8}
              value={exportScale}
              onChange={setExportScale}
              disabled={disabled}
            />
            <p className="presets-hint" style={{ marginTop: 4 }}>
              Each halftone pixel becomes this many sharp pixels in the downloaded PNG.
            </p>
          </div>
        </div>
      </aside>

      <main className="workspace" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
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
              className="ascii-stage pixel-stage"
              style={{ backgroundColor: stageBackground }}
            >
              <AsciiViewportFit key={fitRevision} revision={fitRevision}>
                {overlayOnImage && previewUrl && halftoneResult && sourceBitmap ? (
                  <HalftoneOverlay
                    bitmap={sourceBitmap}
                    previewUrl={previewUrl}
                    result={halftoneResult}
                    photoGrayscale={overlayPhotoGrayscale}
                  />
                ) : halftoneResult ? (
                  <canvas
                    ref={canvasRef}
                    className="pixel-canvas"
                    style={{ imageRendering: 'pixelated' }}
                    aria-label="Halftone preview"
                  />
                ) : null}
              </AsciiViewportFit>
            </div>
          )}
        </div>
      </main>

      <div className="right-rail">
        <div className="icon-dock" aria-label="Preview actions">
          <RailTip tip="Randomise all settings">
            <button
              type="button"
              className={`icon-btn${randSpinning ? ' is-spinning' : ''}`}
              aria-label="Randomise all settings"
              onClick={() => {
                setRandSpinning(true)
                randomizeSettings()
              }}
              onAnimationEnd={() => setRandSpinning(false)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect
                  x="5"
                  y="5"
                  width="14"
                  height="14"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <circle cx="9" cy="9" r="1.35" fill="currentColor" />
                <circle cx="15" cy="15" r="1.35" fill="currentColor" />
              </svg>
            </button>
          </RailTip>

          <RailTip tip="Paper / background colour">
            <label className="icon-btn icon-swatch">
              <input
                type="color"
                value={stageBackground}
                onChange={(e) => setStageBackground(e.target.value)}
                aria-label="Set background colour"
              />
              <span
                className="swatch-visual"
                style={{ backgroundColor: stageBackground }}
              />
            </label>
          </RailTip>

          <RailTip
            tip={
              isLayered
                ? 'Layered inks use the channel colours in print style'
                : useColor
                  ? 'Switch to single ink colour'
                  : 'Switch to sampled colour dots'
            }
          >
            <button
              type="button"
              className="icon-btn"
              aria-label={
                isLayered
                  ? 'Colour mode not used in layered print style'
                  : useColor
                    ? 'Single ink colour'
                    : 'Sampled colour dots'
              }
              aria-pressed={useColor}
              disabled={!sourceBitmap || isLayered}
              onClick={() => !isLayered && setUseColor((v) => !v)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="8" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="16" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </RailTip>

          <RailTip
            tip={
              isLayered || useColor
                ? 'Ink colour is set per channel in print style'
                : 'Ink colour'
            }
          >
            <label
              className={`icon-btn icon-swatch${useColor || isLayered ? ' is-disabled' : ''}`}
            >
              <input
                type="color"
                value={inkHex}
                disabled={useColor || isLayered}
                onChange={(e) => setInkHex(e.target.value)}
                aria-label="Set ink colour"
              />
              <span className="swatch-visual" style={{ backgroundColor: inkHex }} />
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
                    savePreset()
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
                  <button type="submit" className="presets-save-btn" aria-label="Save preset">
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
                disabled={!halftoneResult}
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
                <button type="button" role="menuitem" onClick={() => void downloadPng()}>
                  Download PNG
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
