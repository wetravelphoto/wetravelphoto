import { fontHref } from '@/lib/fonts'

/**
 * LOADS THE TYPEFACES A SECTION ASKED FOR
 *
 * A font chosen in a panel and never fetched is a control that does nothing —
 * the browser falls back to whatever the site was already using and the choice
 * looks like it was ignored. That was true of every section-level typeface
 * until now: `fontsToLoad()` returns the two site fonts, and nothing collected
 * the rest.
 *
 * `precedence` is what makes React hoist these into `<head>` rather than
 * leaving them in the middle of the document, and it deduplicates by href, so
 * the same family asked for by six sections is fetched once.
 *
 * The two site fonts are already loaded by the root layout; asking again for
 * one of those costs nothing because of that same deduplication, so this does
 * not need to know which they are.
 */
export default function TextFonts({ names }: { names: string[] }) {
  if (names.length === 0) return null
  return (
    <>
      {names.map((name) => (
        <link key={name} rel="stylesheet" href={fontHref(name)} precedence="default" />
      ))}
    </>
  )
}
