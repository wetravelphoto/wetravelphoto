'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  FONT_NAMES,
  PAIRINGS,
  PALETTES,
  cssVariables,
  matchingPairing,
  matchingPalette,
  type StyleTokens,
} from '@/lib/styles/tokens'
import { getFont } from '@/lib/fonts'
import { applyPairing, applyPalette, resetStyles, updateStyles } from '@/app/actions/styles'

/**
 * Design → Style.
 *
 * Pairings and palettes first, individual values underneath. The preview is
 * the point: type set over one of his own photographs, because a font that
 * looks fine on white can disappear entirely over a picture, and grey
 * placeholder blocks never tell you that.
 *
 * Everything previews from LOCAL state, so a change is visible before it is
 * saved — and nothing reaches the live site until Save.
 */
export default function StylePanel({
  initial,
  photoUrl,
}: {
  initial: StyleTokens
  photoUrl: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [tokens, setTokens] = useState<StyleTokens>(initial)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof StyleTokens>(key: K, value: StyleTokens[K]) =>
    setTokens((t) => ({ ...t, [key]: value }))

  const run = (work: () => Promise<unknown>) => {
    setError(null)
    startTransition(async () => {
      try {
        await work()
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.')
      }
    })
  }

  const pairingId = matchingPairing(tokens)
  const paletteId = matchingPalette(tokens)

  // The same variables the live site gets, scoped to the preview box.
  const previewVars = cssVariables(tokens) as React.CSSProperties
  const display = getFont(tokens.display_font)
  const body = getFont(tokens.body_font)

  return (
    <div className="sty-wrap" data-busy={pending}>
      {error && <p className="sty-error">{error}</p>}

      <div className="sty-cols">
        {/* ── Controls ───────────────────────────────────────────────── */}
        <div className="sty-controls">
          <form
            action={(formData) => run(() => updateStyles(formData))}
            autoComplete="off"
          >
            <section className="sty-group">
              <h2 className="sty-h2">Typeface</h2>
              <p className="admin-meta sty-note">
                Pairings that work together. Pick one, then adjust below if you want.
              </p>

              <div className="sty-presets">
                {PAIRINGS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="sty-preset"
                    data-on={pairingId === p.id}
                    disabled={pending}
                    onClick={() => {
                      setTokens((t) => ({
                        ...t,
                        display_font: p.display,
                        body_font: p.body,
                        heading_case: p.heading_case,
                        heading_tracking: p.heading_tracking,
                      }))
                      run(() => applyPairing(p.id))
                    }}
                  >
                    <span
                      className="sty-preset-name"
                      style={{
                        fontFamily: getFont(p.display).stack,
                        textTransform: p.heading_case,
                        letterSpacing: `${p.heading_tracking}em`,
                      }}
                    >
                      {p.name}
                    </span>
                    <span className="sty-preset-note">{p.note}</span>
                  </button>
                ))}
              </div>

              <div className="sty-pair">
                <label className="admin-field">
                  Headings
                  <select
                    name="display_font"
                    value={tokens.display_font}
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
                  <select
                    name="body_font"
                    value={tokens.body_font}
                    onChange={(e) => set('body_font', e.target.value)}
                  >
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
                    name="heading_case"
                    value={tokens.heading_case}
                    onChange={(e) =>
                      set('heading_case', e.target.value as StyleTokens['heading_case'])
                    }
                  >
                    <option value="uppercase">CAPITALS</option>
                    <option value="none">As typed</option>
                  </select>
                </label>

                <label className="admin-field">
                  Letterspacing — {tokens.heading_tracking.toFixed(2)}em
                  <input
                    type="range"
                    name="heading_tracking"
                    min="-0.05"
                    max="0.3"
                    step="0.01"
                    value={tokens.heading_tracking}
                    onChange={(e) => set('heading_tracking', Number(e.target.value))}
                  />
                </label>
              </div>
            </section>

            <section className="sty-group">
              <h2 className="sty-h2">Colour</h2>
              <p className="admin-meta sty-note">
                Six values, chosen together. Hairlines follow your ink, so they stay right on a
                dark palette.
              </p>

              <div className="sty-palettes">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="sty-palette"
                    data-on={paletteId === p.id}
                    disabled={pending}
                    title={p.note}
                    onClick={() => {
                      setTokens((t) => ({
                        ...t,
                        surface: p.surface,
                        surface_alt: p.surface_alt,
                        ink: p.ink,
                        ink_soft: p.ink_soft,
                        ink_mute: p.ink_mute,
                        accent: p.accent,
                      }))
                      run(() => applyPalette(p.id))
                    }}
                  >
                    <span className="sty-swatches">
                      {[p.surface, p.surface_alt, p.ink_soft, p.ink, p.accent].map((c, i) => (
                        <span key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="sty-preset-name sty-palette-name">{p.name}</span>
                    <span className="sty-preset-note">{p.note}</span>
                  </button>
                ))}
              </div>

              <div className="sty-colours">
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
                  <label key={key} className="sty-colour">
                    <input
                      type="color"
                      name={key}
                      value={tokens[key]}
                      onChange={(e) => set(key, e.target.value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="sty-group">
              <h2 className="sty-h2">Measure</h2>

              <div className="sty-pair">
                <label className="admin-field">
                  Content width — {tokens.container}px
                  <input
                    type="range"
                    name="container"
                    min="900"
                    max="1800"
                    step="20"
                    value={tokens.container}
                    onChange={(e) => set('container', Number(e.target.value))}
                  />
                </label>

                <label className="admin-field">
                  Space between sections — {tokens.rhythm.toFixed(2)}×
                  <input
                    type="range"
                    name="rhythm"
                    min="0.6"
                    max="1.6"
                    step="0.05"
                    value={tokens.rhythm}
                    onChange={(e) => set('rhythm', Number(e.target.value))}
                  />
                </label>

                <label className="admin-field">
                  Button shape
                  <select
                    name="button_shape"
                    value={tokens.button_shape}
                    onChange={(e) =>
                      set('button_shape', e.target.value as StyleTokens['button_shape'])
                    }
                  >
                    <option value="square">Square</option>
                    <option value="soft">Softened</option>
                    <option value="pill">Pill</option>
                  </select>
                </label>

                <label className="admin-field">
                  Button text
                  <select
                    name="button_case"
                    value={tokens.button_case}
                    onChange={(e) =>
                      set('button_case', e.target.value as StyleTokens['button_case'])
                    }
                  >
                    <option value="uppercase">CAPITALS</option>
                    <option value="none">As typed</option>
                  </select>
                </label>
              </div>

              {/* The colour inputs above post as part of this form too, so a
                  hand-picked colour and a slider save in one go. */}
              <input type="hidden" name="line_opacity" value={tokens.line_opacity} />
            </section>

            <div className="sty-actions">
              <button type="submit" className="admin-btn" disabled={pending}>
                Save styles
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-ghost"
                disabled={pending}
                onClick={() => {
                  if (confirm('Put every style back to the values the site shipped with?')) {
                    setTokens(initial)
                    run(() => resetStyles())
                  }
                }}
              >
                Reset
              </button>
            </div>
          </form>
        </div>

        {/* ── Preview ────────────────────────────────────────────────── */}
        <aside className="sty-preview-rail">
          <p className="admin-meta" style={{ margin: '0 0 0.5rem' }}>
            Preview
          </p>

          <div className="sty-preview" style={previewVars}>
            <div className="sty-shot">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" />
              ) : (
                <div className="sty-shot-empty" />
              )}
              <div className="sty-shot-scrim" />
              <div className="sty-shot-type">
                <span className="sty-over">Selected work</span>
                <span className="sty-title">Quiet Places</span>
              </div>
            </div>

            <div className="sty-body">
              <span className="sty-over sty-over-ink">Field notes</span>
              <h3 className="sty-title sty-title-ink">A heading in your face</h3>
              <p className="sty-para">
                Body copy set in {body.name}, at the size a visitor actually reads it. Long enough
                to show what a paragraph of your writing will feel like on the page.
              </p>
              <p className="sty-caption">A caption — Patagonia, 2026</p>
              <span className="sty-button">View gallery</span>
            </div>
          </div>

          <p className="admin-meta sty-note" style={{ marginTop: '0.6rem' }}>
            {display.name} over {body.name}. Type is previewed on a photograph because that is
            where it has to survive.
          </p>
        </aside>
      </div>
    </div>
  )
}
