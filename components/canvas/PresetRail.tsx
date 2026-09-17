'use client'

import {
  PAIRINGS,
  PALETTES,
  matchingPairing,
  matchingPalette,
  type StyleTokens,
} from '@/lib/styles/tokens'

/**
 * The left rail in Style mode: whole combinations, chosen on purpose.
 *
 * This is deliberately the FIRST thing offered, with the individual colours and
 * typefaces on the other side of the screen. The premise of the whole builder
 * is "enough freedom to feel unique, enough structure that it is hard to look
 * bad", and an open colour picker on seven slots is how you get maroon body
 * text on a teal ground. The easy path is a good one; the precise path is still
 * there.
 *
 * Each swatch is drawn in its own colours, and each pairing is set in its own
 * typefaces — because a list of names tells you nothing about what you are
 * choosing.
 */
export default function PresetRail({
  tokens,
  onPairing,
  onPalette,
  onReset,
}: {
  tokens: StyleTokens
  onPairing: (id: string) => void
  onPalette: (id: string) => void
  onReset: () => void
}) {
  const pairing = matchingPairing(tokens)
  const palette = matchingPalette(tokens)

  return (
    <aside className="cv-rail cv-rail-style" aria-label="Style presets">
      <p className="cv-rail-head">Palette</p>

      <div className="cv-swatches">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            type="button"
            className="cv-swatch"
            data-on={palette === p.id}
            onClick={() => onPalette(p.id)}
            title={p.note}
          >
            <span className="cv-swatch-chips" aria-hidden="true">
              <span style={{ background: p.surface }} />
              <span style={{ background: p.surface_alt }} />
              <span style={{ background: p.ink }} />
              <span style={{ background: p.accent }} />
            </span>
            <span className="cv-swatch-name">{p.name}</span>
          </button>
        ))}
      </div>

      <p className="cv-rail-head" style={{ marginTop: '1.1rem' }}>
        Type
      </p>

      <div className="cv-pairings">
        {PAIRINGS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="cv-pairing"
            data-on={pairing === p.id}
            onClick={() => onPairing(p.id)}
            title={p.note}
          >
            {/* Set in the pairing's own faces. A name tells you nothing. */}
            <span
              className="cv-pairing-display"
              style={{
                fontFamily: `'${p.display}', sans-serif`,
                textTransform: p.heading_case === 'uppercase' ? 'uppercase' : 'none',
                letterSpacing: `${p.heading_tracking}em`,
              }}
            >
              {p.name}
            </span>
            <span className="cv-pairing-body" style={{ fontFamily: `'${p.body}', sans-serif` }}>
              {p.note}
            </span>
          </button>
        ))}
      </div>

      <button type="button" className="cv-add cv-reset" onClick={onReset}>
        Back to the original
      </button>
    </aside>
  )
}
