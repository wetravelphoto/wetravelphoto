'use client'

/**
 * A SHORT LIST AS A ROW OF PICTURES
 * ═════════════════════════════════
 *
 * Instead of a drop-down, for a choice with few options where each has a
 * picture that says it faster than its name does.
 *
 * A drop-down hides every option but one. To find out that a hero can be a
 * video you have to open it, and to compare three you have to open it three
 * times. A row of three says what is available without being touched, and
 * choosing is one click rather than two.
 *
 * ── The name is still there ─────────────────────────────────────────────────
 *
 * On hover and to a screen reader, always. An icon row that cannot be read is
 * a guessing game, and the whole point is that it answers faster than words —
 * not that it withholds them. Which is also why this is only for lists that
 * are SHORT and pictorial; fifteen mystery glyphs would be worse than fifteen
 * lines of text.
 *
 * ── Radio buttons underneath ────────────────────────────────────────────────
 *
 * They look like buttons and they are a radio group, which is not a detail.
 * The settings form saves by listening for a change event on itself, and a
 * <button> does not fire one — an earlier version wrote the value into a
 * hidden input and nothing ever saved. A radio fires the event the form is
 * already waiting for, submits under the field's own name, and brings arrow-
 * key navigation and a single tab stop with it.
 */

/** Drawn at the size of the button, in one stroke weight, so they read as a set. */
function Glyph({ name }: { name: string }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 17,
    height: 17,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'image':
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="18" height="15" rx="2" />
          <circle cx="8.5" cy="10" r="1.6" />
          <path d="M3.5 17l5-5 4.5 4.5L16 14l4.5 4.5" />
        </svg>
      )
    case 'video':
      return (
        <svg {...common}>
          <rect x="2.5" y="5.5" width="13" height="13" rx="2" />
          <path d="M15.5 10.5l6-3.5v10l-6-3.5z" />
        </svg>
      )
    case 'color':
      return (
        <svg {...common}>
          {/* A brush, which is what "a color of my own" means here. */}
          <path d="M18.5 3.5a2.1 2.1 0 0 1 3 3L12 16l-4 1 1-4z" />
          <path d="M3.5 20.5c2 0 2.5-1.5 2.5-3a2.5 2.5 0 1 0-2.5 2.5z" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      )
  }
}

export default function IconChoice({
  name,
  label,
  help,
  value,
  options,
  onChange,
}: {
  /** The setting's key — this is a real radio group and saves under it. */
  name: string
  label: string
  help?: string
  value: string
  options: { value: string; label: string; icon?: string }[]
  onChange: (next: string) => void
}) {
  return (
    <div className="admin-field ic-field">
      <span className="ic-label">{label}</span>
      <div className="ic-row" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const active = option.value === value
          return (
            <label
              key={option.value}
              className="ic-btn"
              data-on={active || undefined}
              // Named on hover — an icon row that cannot be read is a
              // guessing game.
              title={option.label}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
              />
              <Glyph name={option.icon ?? option.value} />
              <span className="cv-sr">{option.label}</span>
            </label>
          )
        })}
      </div>
      {help && <span className="admin-meta">{help}</span>}
    </div>
  )
}
