import { PAGES, PAGE_SLUGS, type PageSlug } from '@/lib/sections/pages'

/**
 * THE BUILT-IN PAGES A VISITOR CAN ACTUALLY BE ON
 * ══════════════════════════════════════════════
 *
 * `PAGES` in lib/sections/pages.ts is the editor's list, and it has one entry
 * that is not an address: `notfound`, the 404 page, which Next draws in place
 * of whatever was asked for. Its `path` is `/404`, which exists so the editor
 * has something to link to for a look at it, and which nobody visits. Counting
 * it would mean counting every mistyped address under one heading, with the
 * mistyped address itself written into `path` — an attacker-chosen string in a
 * column the photographer's dashboard reads.
 *
 * So the tracked set is `PAGES` minus that one, and it is DERIVED here rather
 * than typed out again, so that a page added to the editor tomorrow is tracked
 * without anybody remembering to come back.
 *
 * The same map exists a second time, in SQL, inside `record_page_view` — which
 * has to have it, because validating the path against the resource is the whole
 * point of that function and it cannot import TypeScript. Two copies of one
 * thing drift, so `.mk/analytics.ts` reads the migration and asserts that the
 * two agree, exactly as `.mk/jobs.ts` does for the queue's kind allow-list.
 */

/**
 * Built-in pages that have a public address.
 *
 * Annotated `PageSlug[]` on purpose. TypeScript 5.5 and later infer a type
 * PREDICATE from a callback like this one, so without the annotation the array
 * is typed as "every page except notfound" and `includes(someString)` below
 * stops compiling — the narrowing is correct and useless, because the question
 * being asked is whether an arbitrary string is in the list.
 */
export const TRACKED_PAGE_KEYS: PageSlug[] = PAGE_SLUGS.filter((key) => key !== 'notfound')

/** The public address of a built-in page, or null if it has none. */
export function builtinPath(key: string): string | null {
  if (!TRACKED_PAGE_KEYS.includes(key as PageSlug)) return null
  return PAGES[key as PageSlug].path
}

/** The built-in page at a public address, or null. */
export function builtinKeyAt(path: string): PageSlug | null {
  return TRACKED_PAGE_KEYS.find((key) => PAGES[key].path === path) ?? null
}
