/**
 * ONE ICON SET FOR THE WHOLE WORKSPACE
 * ════════════════════════════════════
 *
 * Drawn, at one size, on one grid, in one stroke weight.
 *
 * ── Why drawn and not characters ────────────────────────────────────────────
 *
 * The admin used `↗`, `▾`, `×` and a few emoji. Every one of them is a glyph
 * from whatever font happens to resolve, which means a different shape, a
 * different weight and a different SIZE on every machine — and a character
 * like `▾` is a small mark inside a large em box, so making it bigger makes
 * the box bigger and the mark much the same. That exact bug cost two rounds of
 * "the arrows are still tiny" in the page editor. A path in a 24-unit box is
 * the size it says it is, everywhere.
 *
 * ── Why one component and not one file each ─────────────────────────────────
 *
 * The thing that makes a set read as a set is that the members agree: same
 * box, same stroke, same joins, same optical weight. Twenty files agree for
 * about a week. One map cannot drift from itself, and adding an icon is one
 * entry rather than a decision about how thick to draw it.
 *
 * Decorative by default — `aria-hidden`, because an icon beside its own label
 * read out twice is worse than one not read out at all. An icon-only control
 * puts the name on the BUTTON, not here.
 */

export type IconName =
  // Sidebar
  | 'overview'
  | 'pages'
  | 'design'
  | 'navigation'
  | 'domains'
  | 'galleries'
  | 'journal'
  | 'media'
  | 'store'
  | 'clients'
  | 'inquiries'
  | 'settings'
  | 'help'
  // Chrome and controls
  | 'external'
  | 'chevron-down'
  | 'chevron-right'
  | 'search'
  | 'grid'
  | 'list'
  | 'plus'
  | 'more'
  | 'menu'
  | 'close'
  | 'check'
  // Settings sections
  | 'share'
  | 'bell'
  | 'link'
  | 'send'
  | 'language'
  | 'shield'
  | 'sliders'
  // Page kinds, for the card footers
  | 'home'
  | 'file'
  | 'image'
  | 'bag'
  | 'mail'
  | 'notebook'

/**
 * Every path is drawn in the same 24×24 box with a 1.6 stroke, so they sit at
 * the same optical weight beside 13–14px text.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </>
  ),
  pages: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  design: (
    <>
      {/* A brush, which is what "how it looks" means to a photographer. */}
      <path d="M18.5 3.5a2.1 2.1 0 0 1 3 3L12 16l-4 1 1-4z" />
      <path d="M3.5 20.5c2 0 2.5-1.5 2.5-3a2.5 2.5 0 1 0-2.5 2.5z" />
    </>
  ),
  navigation: (
    <>
      <path d="M4 6h16M4 12h11M4 18h7" />
    </>
  ),
  domains: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
    </>
  ),
  galleries: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M3.5 17l5-5 4.5 4.5L16 14l4.5 4.5" />
    </>
  ),
  journal: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z" />
      <path d="M5 17h14" />
      <path d="M9 7.5h6M9 11h6" />
    </>
  ),
  media: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </>
  ),
  store: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </>
  ),
  clients: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.9" />
      <path d="M17.5 14.4A6 6 0 0 1 21 20" />
    </>
  ),
  inquiries: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.05H3a2 2 0 1 1 0-4h.11a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.05 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.49 1.04z" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.4" />
      <path d="M12 17h.01" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5" />
    </>
  ),
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  'chevron-right': <path d="M9.5 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8L21 21" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6H21M8.5 12H21M8.5 18H21" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  share: (
    <>
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5" />
      <path d="M10.3 19.5a2 2 0 0 0 3.4 0" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4l-1.3 1.3" />
      <path d="M13.5 10.5a4.5 4.5 0 0 0-6.4 0L4.5 13.1a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3" />
    </>
  ),
  send: (
    <>
      <path d="M21 3L10.5 13.5" />
      <path d="M21 3l-6.8 18-3.7-7.5L3 9.8z" />
    </>
  ),
  language: (
    <>
      <path d="M3 5.5h9" />
      <path d="M7.5 3.5v2" />
      <path d="M10.5 5.5c0 4.5-3 8-6.5 9.5" />
      <path d="M5 10c1 2 3 3.8 5.5 4.5" />
      <path d="M12 20.5l4-10 4 10" />
      <path d="M13.3 17.5h5.4" />
    </>
  ),
  shield: <path d="M12 3l7.5 3v5.5c0 4.5-3 7.8-7.5 9.5-4.5-1.7-7.5-5-7.5-9.5V6z" />,
  /* Gaps in the tracks where the handles sit, so the handle is not a ring with
     a line drawn through it. */
  sliders: (
    <>
      <path d="M6 4v5M6 13v7" />
      <path d="M12 4v9M12 17v3" />
      <path d="M18 4v3M18 11v9" />
      <circle cx="6" cy="11" r="2" />
      <circle cx="12" cy="15" r="2" />
      <circle cx="18" cy="9" r="2" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5L12 4l8 6.5" />
      <path d="M6 9.8V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.8" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M3.5 17l5-5 4.5 4.5L16 14l4.5 4.5" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  notebook: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z" />
      <path d="M5 17h14" />
      <path d="M9 7.5h6M9 11h6" />
    </>
  ),
}

export default function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.6,
}: {
  name: IconName
  size?: number
  className?: string
  /** Raised a little for the very small sizes, so a 13px icon is not spidery. */
  strokeWidth?: number
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
