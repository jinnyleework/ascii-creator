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
  buildEightBit,
  eightBitToPngBlob,
  type DitherMode,
  type EightBitResult,
} from '../eightBitPipeline'
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

const PALETTE_SIZES = [8, 16, 32, 64, 128, 256] as const

const DITHER_OPTIONS: { value: DitherMode; label: string }[] = [
  { value: 'none', label: 'none' },
  { value: 'floyd', label: 'floyd-steinberg' },
  { value: 'bayer4', label: 'ordered 4×4' },
]

type EightPresetSettings = {
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
  animEnabled: boolean
  animSpeed: number
  stageBackground: string
  overlayOnImage: boolean
  exportScale: number
}

type EightPreset = {
  id: string
  name: string
  createdAt: number
  settings: EightPresetSettings
}

const EIGHT_PRESETS_KEY = 'eightbit-creator:presets:v1'

function isValidEightPreset(value: unknown): value is EightPreset {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || typeof v.name !== 'string') return false
  const s = v.settings as Record<string, unknown> | undefined
  if (!s || typeof s !== 'object') return false
  const d = s.dither as string
  const okDither = d === 'none' || d === 'floyd' || d === 'bayer4'
  return (
    typeof s.columns === 'number' &&
    GRAYSCALE_MODES.includes(s.grayscaleMode as GrayscaleMode) &&
    typeof s.imageInvert === 'boolean' &&
    typeof s.solarizeEnabled === 'boolean' &&
    typeof s.solarizeThreshold === 'number' &&
    typeof s.blurPasses === 'number' &&
    typeof s.sharpenAmount === 'number' &&
    typeof s.edgeEmphasis === 'number' &&
    typeof s.useColor === 'boolean' &&
    typeof s.colorSaturationPct === 'number' &&
    typeof s.paletteSize === 'number' &&
    okDither &&
    typeof s.animEnabled === 'boolean' &&
    typeof s.animSpeed === 'number' &&
    typeof s.stageBackground === 'string' &&
    typeof s.overlayOnImage === 'boolean' &&
    typeof s.exportScale === 'number'
  )
}

function loadEightPresets(): EightPreset[] {
  try {
    const raw = localStorage.getItem(EIGHT_PRESETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidEightPreset)
  } catch {
    return []
  }
}

function persistEightPresets(presets: EightPreset[]): void {
  try {
    localStorage.setItem(EIGHT_PRESETS_KEY, JSON.stringify(presets))
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

function randomContrastingBg(): string {
  const bg = randHexColor()
  for (let i = 0; i < 48; i++) {
    const fg = randHexColor()
    if (contrastRatio(bg, fg) >= 3.5) return bg
  }
  return bg
}

function PixelOverlay({
  bitmap,
  previewUrl,
  result,
  photoGrayscale,
}: {
  bitmap: ImageBitmap
  previewUrl: string
  result: EightBitResult
  photoGrayscale: boolean
}) {
  const bw = bitmap.width
  const bh = bitmap.height
  const { cols, rows, imageData } = result
  const d = imageData.data

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
      <div
        className="pixel-overlay-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
      >
        {Array.from({ length: rows * cols }, (_, idx) => {
          const i = idx * 4
          const r = d[i]!
          const g = d[i + 1]!
          const b = d[i + 2]!
          const a = d[i + 3]!
          return (
            <div
              key={idx}
              className="pixel-overlay-cell"
              style={{
                backgroundColor: a === 0 ? 'transparent' : `rgb(${r},${g},${b})`,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function SidebarBrandEightBit({ onBackHome }: { onBackHome: () => void }) {
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
              <p className="sidebar-brand-title">8-bit creator</p>
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

/** CSS width of the upscaled preview (~constant as column count changes). */
const PREVIEW_TARGET_CSS_WIDTH = 480
const PREVIEW_MAX_CSS_HEIGHT = 680
const PREVIEW_CELL_SCALE_MIN = 2
const PREVIEW_CELL_SCALE_MAX = 48

export function EightBitTool({ onBackHome }: { onBackHome: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [columns, setColumns] = useState(120)
  const [grayscaleMode, setGrayscaleMode] = useState<GrayscaleMode>('luminance')
  const [imageInvert, setImageInvert] = useState(false)
  const [solarizeEnabled, setSolarizeEnabled] = useState(false)
  const [solarizeThreshold, setSolarizeThreshold] = useState(128)
  const [blurPasses, setBlurPasses] = useState(0)
  const [sharpenAmount, setSharpenAmount] = useState(0)
  const [edgeEmphasis, setEdgeEmphasis] = useState(0)
  const [useColor, setUseColor] = useState(true)
  const [colorSaturationPct, setColorSaturationPct] = useState(100)
  const [paletteSize, setPaletteSize] = useState<number>(32)
  const [dither, setDither] = useState<DitherMode>('floyd')
  const [animEnabled, setAnimEnabled] = useState(false)
  const [animSpeed, setAnimSpeed] = useState(1)
  const [phase, setPhase] = useState(0)
  const [stageBackground, setStageBackground] = useState('#ffffff')
  const [overlayOnImage, setOverlayOnImage] = useState(false)
  const [overlayPhotoGrayscale, setOverlayPhotoGrayscale] = useState(false)
  const [exportScale, setExportScale] = useState(4)
  const [exportOpen, setExportOpen] = useState(false)
  const [randSpinning, setRandSpinning] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [presets, setPresets] = useState<EightPreset[]>(() => loadEightPresets())
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
    persistEightPresets(presets)
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

  const eightResult: EightBitResult | null = useMemo(() => {
    if (!workBitmap) return null
    return buildEightBit(workBitmap, workBitmap.width, workBitmap.height, {
      columns,
      grayscaleMode,
      imageInvert,
      solarizeEnabled,
      solarizeThreshold,
      blurPasses,
      sharpenAmount,
      edgeEmphasis,
      useColor,
      colorSaturationPct,
      paletteSize,
      dither,
      animationPhase: phase,
      animHueEnabled: animEnabled,
      alphaMatteHex: stageBackground,
    })
  }, [
    workBitmap,
    columns,
    grayscaleMode,
    imageInvert,
    solarizeEnabled,
    solarizeThreshold,
    blurPasses,
    sharpenAmount,
    edgeEmphasis,
    useColor,
    colorSaturationPct,
    paletteSize,
    dither,
    phase,
    animEnabled,
    stageBackground,
  ])

  const previewCellScale = useMemo(() => {
    if (!eightResult) return 4
    const { cols, rows } = eightResult
    if (cols < 1 || rows < 1) return 4
    let s = Math.round(PREVIEW_TARGET_CSS_WIDTH / cols)
    if (rows * s > PREVIEW_MAX_CSS_HEIGHT) {
      s = Math.floor(PREVIEW_MAX_CSS_HEIGHT / rows)
    }
    return Math.max(
      PREVIEW_CELL_SCALE_MIN,
      Math.min(PREVIEW_CELL_SCALE_MAX, s)
    )
  }, [eightResult])

  const fitRevision = useMemo(
    () =>
      [
        eightResult?.cols ?? 0,
        eightResult?.rows ?? 0,
        columns,
        previewCellScale,
        overlayOnImage ? 1 : 0,
        workBitmap?.width ?? 0,
        workBitmap?.height ?? 0,
        stageBackground,
      ].join('\u001e'),
    [
      eightResult?.cols,
      eightResult?.rows,
      columns,
      previewCellScale,
      overlayOnImage,
      workBitmap?.width,
      workBitmap?.height,
      stageBackground,
    ]
  )

  useLayoutEffect(() => {
    const c = canvasRef.current
    if (!c || !eightResult || overlayOnImage) return
    const { cols, rows, imageData } = eightResult
    const s = previewCellScale
    c.width = cols * s
    c.height = rows * s
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    const tmp = document.createElement('canvas')
    tmp.width = cols
    tmp.height = rows
    const tctx = tmp.getContext('2d')
    if (!tctx) return
    tctx.putImageData(imageData, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(tmp, 0, 0, cols, rows, 0, 0, cols * s, rows * s)
  }, [eightResult, overlayOnImage, previewCellScale])

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
    if (!eightResult) return
    const blob = await eightBitToPngBlob(eightResult, {
      scale: exportScale,
      background: stageBackground,
      pixelRatio: 2,
    })
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (file?.name.replace(/\.[^.]+$/, '') ?? '8bit') + '.png'
    a.click()
    URL.revokeObjectURL(a.href)
    setExportOpen(false)
  }, [eightResult, exportScale, stageBackground, file?.name])

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
    (): EightPresetSettings => ({
      columns,
      grayscaleMode,
      imageInvert,
      solarizeEnabled,
      solarizeThreshold,
      blurPasses,
      sharpenAmount,
      edgeEmphasis,
      useColor,
      colorSaturationPct,
      paletteSize,
      dither,
      animEnabled,
      animSpeed,
      stageBackground,
      overlayOnImage,
      exportScale,
    }),
    [
      columns,
      grayscaleMode,
      imageInvert,
      solarizeEnabled,
      solarizeThreshold,
      blurPasses,
      sharpenAmount,
      edgeEmphasis,
      useColor,
      colorSaturationPct,
      paletteSize,
      dither,
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
    const preset: EightPreset = {
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

  const applyPreset = useCallback((p: EightPreset) => {
    const s = p.settings
    setColumns(s.columns)
    setGrayscaleMode(s.grayscaleMode)
    setImageInvert(s.imageInvert)
    setSolarizeEnabled(s.solarizeEnabled)
    setSolarizeThreshold(s.solarizeThreshold)
    setBlurPasses(s.blurPasses)
    setSharpenAmount(s.sharpenAmount)
    setEdgeEmphasis(s.edgeEmphasis)
    setUseColor(s.useColor)
    setColorSaturationPct(s.colorSaturationPct)
    setPaletteSize(s.paletteSize)
    setDither(s.dither)
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
    setColumns(randInt(60, 280))
    setGrayscaleMode(GRAYSCALE_MODES[randInt(0, GRAYSCALE_MODES.length - 1)]!)
    setImageInvert(randBool())
    setSolarizeEnabled(randBool())
    setSolarizeThreshold(randInt(0, 255))
    setBlurPasses(randInt(0, 6))
    setSharpenAmount(randInt(0, 250) / 100)
    setEdgeEmphasis(randInt(0, 100) / 100)
    setUseColor(randBool())
    setColorSaturationPct(randInt(80, 220))
    setPaletteSize(PALETTE_SIZES[randInt(0, PALETTE_SIZES.length - 1)]!)
    setDither(DITHER_OPTIONS[randInt(0, DITHER_OPTIONS.length - 1)]!.value)
    setAnimEnabled(randBool())
    setAnimSpeed(randInt(20, 280) / 100)
    setStageBackground(randomContrastingBg())
    setOverlayOnImage(randBool())
    setExportScale(randInt(2, 8))
  }, [])

  const grayscaleLabel: Record<GrayscaleMode, string> = {
    luminance: 'luminance',
    average: 'average',
    lightness: 'lightness',
    red: 'red channel',
    green: 'green channel',
    blue: 'blue channel',
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
          <SidebarBrandEightBit onBackHome={onBackHome} />
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
                  if (!on) setOverlayPhotoGrayscale(false)
                }}
              />
              <span>overlay on image</span>
              <InfoTip label="Draws the quantised pixel grid on top of your source image, aligned to the same sampling grid as the flat preview." />
            </label>
            <label className="rich-check">
              <input
                type="checkbox"
                checked={overlayPhotoGrayscale}
                disabled={disabled || !overlayOnImage}
                onChange={(e) => setOverlayPhotoGrayscale(e.target.checked)}
              />
              <span>{'B&W underlay'}</span>
              <InfoTip label="When overlay is on, shows the photo in greyscale under the pixel layer." />
            </label>
          </div>

          <div className="section section--pad-y">
            <p className={`section-label${disabled ? ' section-label--disabled' : ''}`}>
              palette
            </p>
            <Combobox
              value={String(paletteSize)}
              disabled={disabled}
              ariaLabel="Palette size"
              options={PALETTE_SIZES.map((n) => ({
                value: String(n),
                label: `${n} colours`,
              }))}
              onChange={(v) => setPaletteSize(Number(v))}
            />
            <Combobox<DitherMode>
              value={dither}
              disabled={disabled}
              ariaLabel="Dithering"
              options={DITHER_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              onChange={(v) => setDither(v)}
            />
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
              <InfoTip label="Flips source brightness before tone processing (same idea as ASCII)." />
            </label>
            <label className="rich-check">
              <input
                type="checkbox"
                checked={solarizeEnabled}
                disabled={disabled}
                onChange={(e) => setSolarizeEnabled(e.target.checked)}
              />
              <span>solarise</span>
              <InfoTip label="Splits tones at a threshold, Sabattier-style, before palette reduction." />
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
          </div>

          <div className="section section--pad-y">
            <RangeRow
              label="glow"
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
              onChange={(n: number) => setEdgeEmphasis(n / 100)}
              disabled={disabled}
            />
            <RangeRow
              label="sharpen"
              valueLabel={sharpenAmount.toFixed(2)}
              min={0}
              max={300}
              value={Math.round(sharpenAmount * 100)}
              onChange={(n: number) => setSharpenAmount(n / 100)}
              disabled={disabled}
            />
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
            <RangeRow
              label="speed"
              valueLabel={String(Math.round(animSpeed * 100))}
              min={20}
              max={300}
              value={Math.round(animSpeed * 100)}
              onChange={(n: number) => setAnimSpeed(n / 100)}
              disabled={disabled || !animEnabled}
            />
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
              Each low-res pixel becomes this many sharp pixels in the downloaded PNG.
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
                {overlayOnImage && previewUrl && eightResult && sourceBitmap ? (
                  <PixelOverlay
                    bitmap={sourceBitmap}
                    previewUrl={previewUrl}
                    result={eightResult}
                    photoGrayscale={overlayPhotoGrayscale}
                  />
                ) : eightResult ? (
                  <canvas
                    ref={canvasRef}
                    className="pixel-canvas"
                    style={{ imageRendering: 'pixelated' }}
                    aria-label="8-bit preview"
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

          <RailTip tip="Background colour">
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

          <RailTip tip={useColor ? 'Switch to greyscale pixels' : 'Switch to colour pixels'}>
            <button
              type="button"
              className="icon-btn"
              aria-label={useColor ? 'Greyscale pixels' : 'Colour pixels'}
              aria-pressed={useColor}
              disabled={!sourceBitmap}
              onClick={() => setUseColor((v) => !v)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="8" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="16" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
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
                disabled={!eightResult}
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
