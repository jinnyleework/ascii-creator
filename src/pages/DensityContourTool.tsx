import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import type { AsciiResult, GrayscaleMode } from '../asciiPipeline'
import { asciiResultToSvg } from '../asciiPipeline'
import { DEFAULT_CHARSET } from '../charset'
import { asciiResultToPngBlob } from '../exportPng'
import {
  buildDensityContoursFromField,
  sampleDensityCornerField,
} from '../densityContourPipeline'
import {
  buildContourVectorPaths,
  contourPathsToSvgDocument,
} from '../contourVector'
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

function SidebarBrandDensity({ onBackHome }: { onBackHome: () => void }) {
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
              <p className="sidebar-brand-title">density contours</p>
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

export function DensityContourTool({ onBackHome }: { onBackHome: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [columns, setColumns] = useState(100)
  const [grayscaleMode, setGrayscaleMode] = useState<GrayscaleMode>('luminance')
  const [imageInvert, setImageInvert] = useState(false)
  const [blurPasses, setBlurPasses] = useState(1)
  const [contourLevels, setContourLevels] = useState(8)
  const [contourHex, setContourHex] = useState('#0a0a0a')
  const [charset, setCharset] = useState(DEFAULT_CHARSET)
  const [useColor, setUseColor] = useState(false)
  const [contoursOnly, setContoursOnly] = useState(false)
  const [showVectorContours, setShowVectorContours] = useState(true)
  /** Finer internal grid for marching squares (1 = blocky, 6 = smoother). */
  const [lineSmoothnessMul, setLineSmoothnessMul] = useState(4)
  /** Stroke width in viewBox units (matched to output columns). */
  const [vectorStroke, setVectorStroke] = useState(0.34)
  const [stageBackground, setStageBackground] = useState('#f4f4f5')
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle')
  const [exportOpen, setExportOpen] = useState(false)
  const [bgRemoveBusy, setBgRemoveBusy] = useState(false)
  const [bgRemoveError, setBgRemoveError] = useState<string | null>(null)
  const [nobgFile, setNobgFile] = useState<File | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)

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

  const field = useMemo(() => {
    if (!workBitmap) return null
    return sampleDensityCornerField(workBitmap, workBitmap.width, workBitmap.height, {
      columns,
      grayscaleMode,
      imageInvert,
      blurPasses,
      contourLevels,
      alphaMatteHex: stageBackground,
    })
  }, [
    workBitmap,
    columns,
    grayscaleMode,
    imageInvert,
    blurPasses,
    contourLevels,
    stageBackground,
  ])

  const result: AsciiResult | null = useMemo(() => {
    if (!field) return null
    return buildDensityContoursFromField(field, {
      charset,
      useColor,
      contourHex,
      contoursOnly,
    })
  }, [field, charset, useColor, contourHex, contoursOnly])

  const vectorSet = useMemo(() => {
    if (!field) return null
    return buildContourVectorPaths(
      field.gray,
      field.cw,
      field.ch,
      field.cols,
      field.rows,
      field.levels,
      lineSmoothnessMul
    )
  }, [field, lineSmoothnessMul])

  const plainText = result?.plainText ?? ''
  const disabled = !sourceBitmap

  const fitRevision = useMemo(
    () =>
      [
        result?.cols ?? 0,
        result?.rows ?? 0,
        plainText.length,
        columns,
        useColor ? 1 : 0,
        contoursOnly ? 1 : 0,
        stageBackground,
        contourHex,
        showVectorContours ? 1 : 0,
        lineSmoothnessMul,
        vectorStroke,
      ].join('\u001e'),
    [
      result?.cols,
      result?.rows,
      plainText.length,
      columns,
      useColor,
      contoursOnly,
      stageBackground,
      contourHex,
      showVectorContours,
      lineSmoothnessMul,
      vectorStroke,
    ]
  )

  const onFile = useCallback((f: File | null) => {
    setFile(f)
    setNobgFile(null)
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
    a.download = (file?.name.replace(/\.[^.]+$/, '') ?? 'density-contours') + '.txt'
    a.click()
    URL.revokeObjectURL(a.href)
    setExportOpen(false)
  }, [plainText, file?.name])

  const downloadContourLinesSvg = useCallback(() => {
    if (!vectorSet) return
    const svg = contourPathsToSvgDocument(vectorSet, {
      stroke: contourHex,
      strokeWidth: vectorStroke,
      background: stageBackground,
    })
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download =
      (file?.name.replace(/\.[^.]+$/, '') ?? 'density-contours') + '-lines.svg'
    a.click()
    URL.revokeObjectURL(a.href)
    setExportOpen(false)
  }, [vectorSet, contourHex, vectorStroke, stageBackground, file?.name])

  const downloadSvg = useCallback(() => {
    if (!result) return
    const svg = asciiResultToSvg(result, {
      fontSize: 10,
      lineHeight: 11,
      charAdvanceEm: 0.62,
      background: stageBackground,
      animated: false,
    })
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (file?.name.replace(/\.[^.]+$/, '') ?? 'density-contours') + '.svg'
    a.click()
    URL.revokeObjectURL(a.href)
    setExportOpen(false)
  }, [result, stageBackground, file?.name])

  const downloadPng = useCallback(async () => {
    if (!result?.plainText) return
    const blob = await asciiResultToPngBlob(result, {
      background: stageBackground,
      fontSize: 14,
      pixelRatio: 2,
    })
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (file?.name.replace(/\.[^.]+$/, '') ?? 'density-contours') + '.png'
    a.click()
    URL.revokeObjectURL(a.href)
    setExportOpen(false)
  }, [result, stageBackground, file?.name])

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
          <SidebarBrandDensity onBackHome={onBackHome} />
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
            <RangeRow
              label="contour levels"
              valueLabel={String(contourLevels)}
              min={1}
              max={24}
              value={contourLevels}
              onChange={setContourLevels}
              disabled={disabled}
            />
            <p className="presets-hint" style={{ marginTop: 6 }}>
              Iso-lines are evenly spaced between the darkest and brightest samples after blur.
            </p>
            <RangeRow
              label="field smoothness"
              valueLabel={String(blurPasses)}
              min={0}
              max={8}
              value={blurPasses}
              onChange={setBlurPasses}
              disabled={disabled}
            />
            <label className="rich-check">
              <input
                type="checkbox"
                checked={contoursOnly}
                disabled={disabled}
                onChange={(e) => setContoursOnly(e.target.checked)}
              />
              <span>contours only</span>
              <InfoTip label="Hides the character density fill and draws only iso-line junctions on the stage background." />
            </label>
            <label className="rich-check">
              <input
                type="checkbox"
                checked={showVectorContours}
                disabled={disabled}
                onChange={(e) => setShowVectorContours(e.target.checked)}
              />
              <span>draw contour lines</span>
              <InfoTip label="Overlays smooth vector iso-lines (marching squares) on the preview, like a topographic map. The character layer stays underneath for text / glyph exports." />
            </label>
            {showVectorContours && (
              <>
                <RangeRow
                  label="line smoothness"
                  valueLabel={`×${lineSmoothnessMul}`}
                  min={1}
                  max={6}
                  value={lineSmoothnessMul}
                  onChange={setLineSmoothnessMul}
                  disabled={disabled}
                />
                <RangeRow
                  label="line weight"
                  valueLabel={vectorStroke.toFixed(2)}
                  min={8}
                  max={80}
                  value={Math.round(vectorStroke * 100)}
                  onChange={(n) => setVectorStroke(n / 100)}
                  disabled={disabled}
                />
              </>
            )}
          </div>

          <div className="section section--pad-y">
            <p className={`section-label${disabled ? ' section-label--disabled' : ''}`}>
              density ramp
            </p>
            <textarea
              className="textarea"
              rows={3}
              value={charset}
              onChange={(e) => setCharset(e.target.value)}
              placeholder="Characters from light to dark…"
              spellCheck={false}
              disabled={disabled || contoursOnly}
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
              <InfoTip label="Flips brightness before the density field is built." />
            </label>
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
            <div className="ascii-stage" style={{ backgroundColor: stageBackground }}>
              <AsciiViewportFit key={fitRevision} revision={fitRevision}>
                {result && vectorSet ? (
                  <div className="density-preview-stack" aria-live="polite">
                    <div className="ascii ascii--color density-preview-stack__ascii">
                      {result.lines.map((row, yi) => (
                        <div className="ascii-line" key={yi}>
                          {row.map((cell, xi) => (
                            <span key={`${yi}-${xi}`} style={{ color: cell.color }}>
                              {cell.ch}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                    {showVectorContours && (
                      <svg
                        className="density-preview-stack__svg"
                        viewBox={`0 0 ${vectorSet.viewBoxWidth} ${vectorSet.viewBoxHeight}`}
                        preserveAspectRatio="none"
                        aria-hidden
                      >
                        {vectorSet.paths.map((p, i) => (
                          <path
                            key={`${p.iso}-${i}`}
                            fill="none"
                            stroke={contourHex}
                            strokeWidth={vectorStroke}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d={p.d}
                          />
                        ))}
                      </svg>
                    )}
                  </div>
                ) : null}
              </AsciiViewportFit>
            </div>
          )}
        </div>
      </main>

      <div className="right-rail">
        <div className="icon-dock" aria-label="Preview actions">
          <RailTip tip="Stage background">
            <label className="icon-btn icon-swatch">
              <input
                type="color"
                value={stageBackground}
                onChange={(e) => setStageBackground(e.target.value)}
                aria-label="Set stage background colour"
              />
              <span
                className="swatch-visual"
                style={{ backgroundColor: stageBackground }}
              />
            </label>
          </RailTip>

          <RailTip tip="Contour line colour">
            <label className="icon-btn icon-swatch">
              <input
                type="color"
                value={contourHex}
                onChange={(e) => setContourHex(e.target.value)}
                aria-label="Set contour line colour"
              />
              <span className="swatch-visual" style={{ backgroundColor: contourHex }} />
            </label>
          </RailTip>

          <RailTip tip={useColor ? 'Fill uses sampled colour' : 'Fill uses ramp + line colour'}>
            <button
              type="button"
              className="icon-btn"
              aria-label={useColor ? 'Greyscale density fill' : 'Colour density fill'}
              aria-pressed={useColor}
              disabled={!sourceBitmap || contoursOnly}
              onClick={() => setUseColor((v) => !v)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="8" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="16" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </RailTip>

          <div className="export-pop" ref={exportRef}>
            <RailTip tip="Export">
              <button
                type="button"
                className="icon-btn"
                aria-expanded={exportOpen}
                aria-haspopup="true"
                disabled={!result?.plainText}
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
                <button type="button" role="menuitem" disabled={!plainText} onClick={downloadTxt}>
                  Download .txt
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!result?.plainText}
                  onClick={downloadSvg}
                >
                  Download SVG (glyphs)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!vectorSet?.paths.some((p) => p.d.length > 0)}
                  onClick={downloadContourLinesSvg}
                >
                  Download contour lines (SVG)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!result?.plainText}
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
