/**
 * A SMALL DRAWING OF EACH SECTION TYPE
 * ════════════════════════════════════
 *
 * Shown on the cards in "Add a section". A name and a sentence tell you what
 * a section IS; a picture tells you what it will look like on the page, which
 * is the thing you are actually choosing between. "Introduction" and "About"
 * read almost the same in words and not at all the same on a page.
 *
 * Deliberately **abstract and drawn in code**, not screenshots:
 *
 *  · a screenshot of one photographer's homepage is wrong for the next one,
 *    and has to be retaken every time a section changes;
 *  · these are three shapes and a few lines, so they stay honest about the
 *    arrangement — a photo on the left, three across, a form on the right —
 *    which is all a 200px card can usefully say;
 *  · nothing to upload, nothing to keep in step, and they inherit the
 *    editor's own colours, so they follow the chrome rather than the site.
 *
 * Adding a section type without adding a drawing is fine: it gets the plain
 * one below. The registry stays the only place a type has to be declared.
 */

/** Everything is drawn on this grid, so the shapes agree across cards. */
const VIEW = '0 0 160 96'

/**
 * A photograph.
 *
 * A plain grey rectangle is also what an empty text block looks like, so
 * anything big enough gets the universal two-hills-and-a-sun inside it. It is
 * the one piece of drawing here that is a picture of something rather than a
 * shape, and it is what makes "three photographs across" read as photographs.
 */
const glyph = (cx: number, cy: number, s: number) => (
  <>
    <circle className="pi" cx={cx - s * 0.52} cy={cy - s * 0.42} r={s * 0.17} />
    <path
      className="pi"
      d={`M${cx - s} ${cy + s * 0.5} L${cx - s * 0.3} ${cy - s * 0.25} L${cx + s * 0.18} ${cy + s * 0.5} Z`}
    />
    <path
      className="pi"
      d={`M${cx - s * 0.15} ${cy + s * 0.5} L${cx + s * 0.42} ${cy - s * 0.1} L${cx + s} ${cy + s * 0.5} Z`}
    />
  </>
)

const P = (x: number, y: number, w: number, h: number, key?: string) => {
  const rect = <rect className="p" x={x} y={y} width={w} height={h} rx={1.5} />
  if (w < 28 || h < 26) return <g key={key}>{rect}</g>
  // The glyph sits in the middle, at a size that follows the frame.
  return (
    <g key={key}>
      {rect}
      {glyph(x + w / 2, y + h / 2, Math.min(w, h) * 0.42)}
    </g>
  )
}

/** A line of text. */
const T = (x: number, y: number, w: number, key?: string) => (
  <rect key={key} className="t" x={x} y={y} width={w} height={4} rx={2} />
)

/** A heading, or anything else that carries the eye first. */
const H = (x: number, y: number, w: number) => (
  <rect className="a" x={x} y={y} width={w} height={6} rx={3} />
)

/** A button. */
const B = (x: number, y: number, w = 30) => (
  <rect className="a" x={x} y={y} width={w} height={9} rx={4.5} />
)

/** A field in a form. */
const F = (x: number, y: number, w: number, key?: string) => (
  <rect key={key} className="f" x={x} y={y} width={w} height={9} rx={2} />
)

const DRAWINGS: Record<string, React.ReactNode> = {
  // The photograph fills the screen and the title sits over it, so the glyph
  // is placed high and the words low rather than on top of one another.
  hero: (
    <>
      <rect className="p" x={0} y={0} width={160} height={96} />
      {glyph(80, 34, 20)}
      <rect className="a" x={48} y={62} width={64} height={7} rx={3.5} />
      {T(58, 76, 44)}
    </>
  ),

  // One small shape on an empty page.
  mark: (
    <>
      <circle className="a" cx={80} cy={42} r={11} />
      {T(58, 62, 44)}
    </>
  ),

  // Words beside a photograph.
  intro: (
    <>
      {P(10, 14, 62, 68)}
      {H(84, 22, 44)}
      {T(84, 38, 60, 'a')}
      {T(84, 48, 60, 'b')}
      {T(84, 58, 38, 'c')}
    </>
  ),

  // The same idea the other way round, and it ends with a button.
  about: (
    <>
      {H(10, 20, 40)}
      {T(10, 36, 66, 'a')}
      {T(10, 46, 66, 'b')}
      {T(10, 56, 44, 'c')}
      {B(10, 68)}
      {P(88, 14, 62, 68)}
    </>
  ),

  // Galleries, three across.
  galleries: (
    <>
      {H(10, 10, 38)}
      {[10, 57, 104].map((x) => P(x, 26, 46, 56, `g${x}`))}
    </>
  ),

  // Stories: the newest one large, the rest beside it.
  journal: (
    <>
      {H(10, 10, 38)}
      {P(10, 26, 68, 56)}
      {P(86, 26, 64, 26, 'b')}
      {P(86, 56, 64, 26, 'c')}
    </>
  ),

  // Prints in a row, each with its caption.
  shop: (
    <>
      {H(10, 10, 38)}
      {[10, 47, 84, 121].map((x) => (
        <g key={`s${x}`}>
          {P(x, 26, 29, 40, `p${x}`)}
          {T(x, 72, 22, `t${x}`)}
        </g>
      ))}
    </>
  ),

  // A strip from Instagram.
  instagram: (
    <>
      {T(64, 14, 32)}
      {[8, 39, 70, 101, 132].map((x) => P(x, 30, 22, 36, `i${x}`))}
    </>
  ),

  // A short invitation, and a form to answer it.
  contact: (
    <>
      {H(10, 22, 40)}
      {T(10, 38, 56, 'a')}
      {T(10, 48, 40, 'b')}
      {F(86, 18, 64, 'a')}
      {F(86, 34, 64, 'b')}
      {F(86, 50, 64, 'c')}
      {B(86, 68, 34)}
    </>
  ),
}

/** Anything the registry gains before it gains a drawing. */
const PLAIN = (
  <>
    {H(10, 22, 40)}
    {T(10, 40, 90, 'a')}
    {T(10, 50, 90, 'b')}
    {T(10, 60, 62, 'c')}
  </>
)

export default function SectionThumb({ type }: { type: string }) {
  return (
    <svg
      className="cv-thumb"
      viewBox={VIEW}
      preserveAspectRatio="xMidYMid slice"
      // Decoration beside a name and a sentence that already say what this is.
      aria-hidden="true"
      focusable="false"
    >
      {DRAWINGS[type] ?? PLAIN}
    </svg>
  )
}
