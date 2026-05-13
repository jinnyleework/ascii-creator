import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import logoAsciiCreator from './assets/logo-ascii-creator.png'
export function pct(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
}

export function clampNum(n: number, lo: number, hi: number): number {
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

export function TooltipSpan({
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

export function RailTip({ tip, children }: { tip: string; children: ReactNode }) {
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
export function Combobox<T extends string>({
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

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
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

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
export function AsciiViewportFit({
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
export function useImageBitmap(file: File | null) {
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

export function InfoTip({ label }: { label: string }) {
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

export function RangeRow(props: {
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
  const [dragging, setDragging] = useState(false)
  const fill = pct(value, min, max)
  const scale = fill / 100

  useEffect(() => {
    if (!dragging) return
    const end = () => setDragging(false)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging])

  return (
    <div className={`range-block${disabled ? ' is-disabled' : ''}`}>
      <div className="row-label">
        <p className="section-label">{label}</p>
        <span className="value-hint">{valueLabel}</span>
      </div>
      <div className="range-track">
        <div
          className={`range-fill${dragging ? ' is-dragging' : ''}`}
          style={{ transform: `scaleX(${scale})` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onPointerDown={() => setDragging(true)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  )
}

function BrandLogoHoverLayers() {
  return (
    <span className="sidebar-brand-home-spin" aria-hidden>
      <span className="sidebar-brand-home-stack">
        <span className="sidebar-brand-home-layer sidebar-brand-home-layer--vector">
          <img
            className="sidebar-brand-logo"
            src={logoAsciiCreator}
            alt=""
            width={33}
            height={36}
            decoding="async"
          />
        </span>
        <span className="sidebar-brand-home-layer sidebar-brand-home-layer--eightbit">
          <span className="sidebar-brand-home-eightbit-wrap">
            <img
              className="sidebar-brand-home-eightbit-img"
              src={logoAsciiCreator}
              alt=""
              width={5}
              height={5}
              decoding="async"
            />
          </span>
        </span>
        <span className="sidebar-brand-home-layer sidebar-brand-home-layer--ascii">
          <span className="sidebar-brand-home-ascii-wrap">
            <img
              className="sidebar-brand-home-ascii-img"
              src={logoAsciiCreator}
              alt=""
              width={14}
              height={15}
              decoding="async"
            />
          </span>
        </span>
      </span>
    </span>
  )
}

/** Decorative mark with the same hover cycle as the sidebar logo (no click). */
export function BrandLogoHoverMark(props: { className?: string }) {
  const { className = '' } = props
  return (
    <span
      className={`sidebar-brand-home-link sidebar-brand-home-link--home${className ? ` ${className}` : ''}`}
      aria-hidden
    >
      <BrandLogoHoverLayers />
    </span>
  )
}

/** Logo in the sidebar: returns to the tool picker; hover runs phase cycle + spin (CSS-only). */
export function ToolBrandHomeLink(props: {
  onPress: () => void
  ariaLabel?: string
}) {
  const { onPress, ariaLabel = 'Back to tool picker' } = props
  return (
    <button
      type="button"
      className="sidebar-brand-home-link"
      onClick={onPress}
      aria-label={ariaLabel}
    >
      <BrandLogoHoverLayers />
    </button>
  )
}
