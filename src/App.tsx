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
  asciiResultToSvg,
  buildAscii,
  type AnimationMode,
  type AsciiResult,
  type GrayscaleMode,
} from './asciiPipeline'
import { DEFAULT_CHARSET } from './charset'
import { asciiResultToPngBlob } from './exportPng'
import './App.css'

const CHARSET_PRESETS: { label: string; value: string }[] = [
  { label: 'Detailed', value: DEFAULT_CHARSET },
  { label: 'Blocks', value: ' ░▒▓█' },
  { label: 'Simple', value: ' .:-=+*#%@' },
  { label: 'Minimal', value: ' .:oO8@' },
]

function pct(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
}

function RailTip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <span className="rail-tip" data-tooltip={tip}>
      {children}
    </span>
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

function LogoMark() {
  return (
    <svg
      className="logo-mark"
      width="33"
      height="36"
      viewBox="0 0 33 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        opacity="0.9"
        d="M16.5 2L20.2 12.4H31.4L22.7 18.4L26.4 28.8L16.5 22.8L6.6 28.8L10.3 18.4L1.6 12.4H12.8L16.5 2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="16.5" cy="14" r="3" fill="currentColor" />
    </svg>
  )
}

function InfoTip({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="info-btn"
      title={label}
      aria-label={label}
      tabIndex={-1}
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
  const [exportOpen, setExportOpen] = useState(false)
  const [bgRemoveBusy, setBgRemoveBusy] = useState(false)
  const [bgRemoveError, setBgRemoveError] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const railGradId = useId().replace(/:/g, '')

  const bitmap = useImageBitmap(file)

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

  const animActive = animEnabled && !!bitmap
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

  const asciiResult: AsciiResult | null = useMemo(() => {
    if (!bitmap) return null
    return buildAscii(bitmap, bitmap.width, bitmap.height, {
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
      animationMode: animEnabled ? animMode : null,
    })
  }, [
    bitmap,
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
    animMode,
  ])

  const plainText = asciiResult?.plainText ?? ''
  const disabled = !bitmap

  const asciiFitRevision = useMemo(
    () =>
      [
        asciiResult?.cols ?? 0,
        asciiResult?.rows ?? 0,
        plainText.length,
        columns,
        useColor ? 1 : 0,
        charset,
      ].join('\u001e'),
    [
      asciiResult?.cols,
      asciiResult?.rows,
      plainText.length,
      columns,
      useColor,
      charset,
    ]
  )

  const presetValue = useMemo(() => {
    const p = CHARSET_PRESETS.find((x) => x.value === charset)
    return p?.label ?? 'Custom'
  }, [charset])

  const onFile = useCallback((f: File | null) => {
    setFile(f)
    setCopyState('idle')
    setBgRemoveError(null)
  }, [])

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      onFile(f && f.type.startsWith('image/') ? f : null)
    },
    [onFile]
  )

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    onFile(f && f.type.startsWith('image/') ? f : null)
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
      const svg = asciiResultToSvg(asciiResult, {
        fontSize: 10,
        lineHeight: 11,
        charAdvanceEm: 0.62,
        background: asciiBackground,
        animated,
      })
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download =
        (file?.name.replace(/\.[^.]+$/, '') ?? 'ascii') +
        (animated ? '-animated' : '') +
        '.svg'
      a.click()
      URL.revokeObjectURL(a.href)
      setExportOpen(false)
    },
    [asciiResult, asciiBackground, file?.name]
  )

  const downloadPng = useCallback(async () => {
    if (!asciiResult?.plainText) return
    const blob = await asciiResultToPngBlob(asciiResult, {
      background: asciiBackground,
      fontSize: 14,
      pixelRatio: 2,
    })
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (file?.name.replace(/\.[^.]+$/, '') ?? 'ascii') + '.png'
    a.click()
    URL.revokeObjectURL(a.href)
    setExportOpen(false)
  }, [
    asciiResult,
    asciiBackground,
    file?.name,
  ])

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
      onFile(
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
  }, [file, bgRemoveBusy, onFile])

  const animModeLabel: Record<AnimationMode, string> = {
    hue: 'hue drift',
    ramp: 'ramp drift',
    solarize: 'solarize sweep',
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
          <LogoMark />
          {bitmap && previewUrl && (
            <>
              <div className="thumb-row">
                <img src={previewUrl} alt="" width={48} height={48} />
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => fileRef.current?.click()}
                >
                  Replace image
                </button>
              </div>
              <button
                type="button"
                className="sidebar-action"
                disabled={!file || bgRemoveBusy}
                onClick={() => void removeImageBackground()}
              >
                {bgRemoveBusy ? 'Removing background…' : 'Remove background'}
              </button>
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
          </div>

          <div className="section section--pad-y">
            <p
              className={`section-label${disabled ? ' section-label--disabled' : ''}`}
            >
              characters
            </p>
            <div className="select-wrap">
              <select
                className="select"
                value={presetValue}
                disabled={disabled}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'Custom') return
                  const p = CHARSET_PRESETS.find((x) => x.label === v)
                  if (p) setCharset(p.value)
                }}
              >
                {CHARSET_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label.toLowerCase()}
                  </option>
                ))}
                <option value="Custom">custom</option>
              </select>
            </div>
            <textarea
              className="textarea"
              rows={3}
              value={charset}
              onChange={(e) => setCharset(e.target.value)}
              placeholder="Custom character ramp…"
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
              <InfoTip label="Swaps light and dark glyphs on the character ramp" />
            </label>
          </div>

          <div className="section section--pad-y">
            <p
              className={`section-label${disabled ? ' section-label--disabled' : ''}`}
            >
              grayscale mode
            </p>
            <select
              className="select"
              value={grayscaleMode}
              disabled={disabled}
              onChange={(e) =>
                setGrayscaleMode(e.target.value as GrayscaleMode)
              }
            >
              {(Object.keys(grayscaleLabel) as GrayscaleMode[]).map((k) => (
                <option key={k} value={k}>
                  {grayscaleLabel[k]}
                </option>
              ))}
            </select>
            <label className="rich-check">
              <input
                type="checkbox"
                checked={imageInvert}
                disabled={disabled}
                onChange={(e) => setImageInvert(e.target.checked)}
              />
              <span>invert image</span>
              <InfoTip label="Inverts luminance before blur, edges, and solarize" />
            </label>
            <label className="rich-check">
              <input
                type="checkbox"
                checked={solarizeEnabled}
                disabled={disabled}
                onChange={(e) => setSolarizeEnabled(e.target.checked)}
              />
              <span>solarise</span>
              <InfoTip label="Inverts tones above the threshold (Sabattier-style)" />
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
              label="blur passes"
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
            <select
              className="select"
              value={animMode}
              disabled={disabled || !animEnabled}
              onChange={(e) =>
                setAnimMode(e.target.value as AnimationMode)
              }
            >
              {(Object.keys(animModeLabel) as AnimationMode[]).map((k) => (
                <option key={k} value={k}>
                  {animModeLabel[k]}
                </option>
              ))}
            </select>
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
          {!bitmap ? (
            <button
              type="button"
              className="drop-hero"
              onClick={() => fileRef.current?.click()}
            >
              <div className="drop-hero-inner">
                <p className="drop-hero-title">Drop an image here</p>
                <p className="drop-hero-hint">or click to choose a file</p>
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
                {useColor && asciiResult ? (
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
              disabled={!bitmap}
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

          <RailTip tip="Character colour">
            <label
              className={`icon-btn icon-swatch${useColor ? ' is-disabled' : ''}`}
            >
              <input
                type="color"
                value={grayscaleGlyphColor}
                disabled={useColor}
                onChange={(e) => setGrayscaleGlyphColor(e.target.value)}
                aria-label="Set ASCII character colour (grayscale mode)"
              />
              <span
                className="swatch-visual"
                style={{ backgroundColor: grayscaleGlyphColor }}
              />
            </label>
          </RailTip>

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
                  disabled={!asciiResult?.plainText}
                  onClick={() => downloadSvg(true)}
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
  )
}
