/**
 * The small line drawings beside the reassurance blurbs on a product page.
 *
 * Drawn rather than fetched: they're two dozen bytes of path data each, they
 * take the surrounding text colour, and they stay crisp at any size. Anything
 * unrecognised falls back to the leaf, so a typed-in name never leaves a hole.
 */
const PATHS: Record<string, string> = {
  paper: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h6M10 16h6',
  shipping: 'M2 7h11v9H2zM13 10h4l4 3.5V16h-8zM6.5 19a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2zM17.5 19a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2z',
  leaf: 'M20 4c0 8.5-4.8 13-11 13H5C5 9.5 10.5 4 20 4zM5 20c2-5 6-8 10-9.5',
  frame: 'M3 4h18v16H3zM7 8h10v8H7z',
  shield: 'M12 3l7 3v5.5c0 4.4-3 7.6-7 9.5-4-1.9-7-5.1-7-9.5V6z',
  hand: 'M9 12V5.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V12m0-1a1.5 1.5 0 013 0v5a5 5 0 01-5 5h-2.6a5 5 0 01-3.9-1.9L5 17l1.2-1.2a2 2 0 012.8 0L9 16',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3.5 9h17M3.5 15h17M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  star: 'M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9L6.7 20l1.1-6L3.4 9.9l6-.8z',
}

export const FEATURE_ICONS = Object.keys(PATHS)

export default function FeatureIcon({ name }: { name?: string | null }) {
  const d = PATHS[name ?? ''] ?? PATHS.leaf

  return (
    <svg
      className="product-feature-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d={d} />
    </svg>
  )
}
