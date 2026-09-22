'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { FONT_NAMES, type StyleTokens } from '@/lib/styles/tokens'
import { updateDraftStyles } from '@/app/actions/canvas'

/**
 * The right rail in Style mode: the individual values, for when someone knows
 * what they want.
 *
 * Every control reports on every change, and the canvas paints the page
 * immediately — a colour picker that only updates when you let go of the mouse
 * is not a colour picker. The save to the draft is debounced behind that, so
 * dragging a slider across its whole range is one write rather than ninety.
 */
const DEBOUNCE_MS = 400

export default function StyleMode({
  resizer,
  tokens,
  overridden,
  onClearOverrides,
  onPreview,
  onCommit,
  pending,
  flushRef,
}: {
  /** The drag handle on this panel's left edge. */
  resizer: React.ReactNode
  tokens: StyleTokens
  /** Sections on this page with typography of their own, which wins over everything here. */
  overridden: string[]
  onClearOverrides: () => void
  /** Every change, immediately — for painting the page. Never hits the network. */
  onPreview: (tokens: StyleTokens) => void
  /** The settled value, for writing to the draft. */
  onCommit: (changes: Partial<StyleTokens>) => void
  pending: boolean
  /** Filled in here: saves anything still on the debounce, awaited. For Undo. */
  flushRef?: React.MutableRefObject<(() => Promise<void>) | null>
}) {
  const [values, setValues] = useState<StyleTokens>(tokens)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queued = useRef<Partial<StyleTokens>>({})
  const [, startTransition] = useTransition()

  /**
   * A preset applied from the other rail comes back through the server, and
   * this panel has to follow it.
   *
   * Compared by VALUE, not identity: `tokens` is rebuilt on every server render
   * so an identity check would re-sync forever. Held in state rather than a ref
   * because this is React's documented "adjust state during render" pattern —
   * it re-renders once before painting, where an effect would paint the stale
   * values first and then correct them.
   */
  const signature = JSON.stringify(tokens)
  const [lastSignature, setLastSignature] = useState(signature)

  if (signature !== lastSignature) {
    setLastSignature(signature)
    setValues(tokens)
  }

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const changes = queued.current
    queued.current = {}
    if (Object.keys(changes).length) startTransition(() => onCommit(changes))
  }

  useEffect(() => {
    if (!flushRef) return
    flushRef.current = async () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const changes = queued.current
      queued.current = {}
      if (Object.keys(changes).length) await updateDraftStyles(changes)
    }
    return () => {
      flushRef.current = null
    }
  }, [flushRef])

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      // Whatever was mid-flight when the mode closed still belongs in the draft.
      const changes = queued.current
      queued.current = {}
      if (Object.keys(changes).length) onCommit(changes)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = <K extends keyof StyleTokens>(key: K, value: StyleTokens[K]) => {
    const next = { ...values, [key]: value }
    setValues(next)
    onPreview(next)

    queued.current = { ...queued.current, [key]: value }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, DEBOUNCE_MS)
  }

  return (
    <aside className="cv-inspector" aria-label="Style">
      {resizer}
      <div className="cv-insp-head">
        <div>
          <p className="cv-insp-label">Style</p>
          <p className="cv-insp-blurb">
            Set once, applies everywhere — every page, every gallery, every section.
          </p>
        </div>
      </div>

      {overridden.length > 0 && (
        <div className="cv-override-warn">
          <p>
            {overridden.length === 1
              ? 'One section on this page has'
              : `${overridden.length} sections on this page have`}{' '}
            typography of their own — {overridden.join(', ')} — which wins over the typeface
            and colour set here.
          </p>
          <button type="button" className="cv-type-clear" onClick={onClearOverrides}>
            Make every section on every page follow the site
          </button>
        </div>
      )}

      <div className="cv-insp-form" onBlur={flush}>
        <div className="sec-fields">
          <div className="sec-group">
            <p className="sec-group-name">Colour</p>
            {(
              [
                ['surface', 'Page'],
                ['surface_alt', 'Bands'],
                ['ink', 'Headings'],
                ['ink_soft', 'Body'],
                ['ink_mute', 'Captions'],
                ['accent', 'Accent'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="cv-colour-row">
                <input
                  type="color"
                  value={values[key]}
                  onChange={(e) => set(key, e.target.value)}
                  aria-label={label}
                />
                <span className="cv-colour-name">{label}</span>
                <span className="cv-colour-hex">{values[key].toUpperCase()}</span>
              </label>
            ))}

            <Slider
              label="Hairlines"
              value={values.line_opacity}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) => set('line_opacity', v)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>

          <div className="sec-group">
            <p className="sec-group-name">Type</p>

            <label className="admin-field">
              Headings
              <select
                value={values.display_font}
                onChange={(e) => set('display_font', e.target.value)}
              >
                {FONT_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              Body
              <select value={values.body_font} onChange={(e) => set('body_font', e.target.value)}>
                {FONT_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              Heading case
              <select
                value={values.heading_case}
                onChange={(e) => set('heading_case', e.target.value as StyleTokens['heading_case'])}
              >
                <option value="uppercase">Capitals</option>
                <option value="none">As written</option>
              </select>
            </label>

            <Slider
              label="Letterspacing"
              value={values.heading_tracking}
              min={-0.05}
              max={0.3}
              step={0.005}
              onChange={(v) => set('heading_tracking', v)}
              format={(v) => `${v.toFixed(3)}em`}
            />
          </div>

          <div className="sec-group">
            <p className="sec-group-name">Measure</p>

            <Slider
              label="Page width"
              value={values.container}
              min={900}
              max={1800}
              step={20}
              onChange={(v) => set('container', Math.round(v))}
              format={(v) => `${Math.round(v)}px`}
            />

            <Slider
              label="Breathing room"
              value={values.rhythm}
              min={0.6}
              max={1.6}
              step={0.05}
              onChange={(v) => set('rhythm', v)}
              format={(v) => `${v.toFixed(2)}×`}
            />
          </div>

          <div className="sec-group">
            <p className="sec-group-name">Buttons</p>

            <label className="admin-field">
              Shape
              <select
                value={values.button_shape}
                onChange={(e) => set('button_shape', e.target.value as StyleTokens['button_shape'])}
              >
                <option value="square">Square</option>
                <option value="soft">Softened</option>
                <option value="pill">Pill</option>
              </select>
            </label>

            <label className="admin-field">
              Label case
              <select
                value={values.button_case}
                onChange={(e) => set('button_case', e.target.value as StyleTokens['button_case'])}
              >
                <option value="uppercase">Capitals</option>
                <option value="none">As written</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="cv-insp-foot">
        <span className="cv-insp-state" aria-live="polite">
          {pending ? 'Saving…' : 'Changes save as you make them'}
        </span>
        <span className="cv-insp-note">
          Nothing here reaches the live site until you publish.
        </span>
      </div>
    </aside>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format: (value: number) => string
}) {
  return (
    <label className="cv-slider">
      <span className="cv-slider-head">
        <span>{label}</span>
        <span className="cv-slider-value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
