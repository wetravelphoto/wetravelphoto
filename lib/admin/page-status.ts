import type { IconName } from '@/components/admin/Icon'

/**
 * WHAT IS TRUE ABOUT A PAGE
 * ═════════════════════════
 *
 * Two facts a photographer needs, and they are not the same fact:
 *
 *   · can a visitor see this page right now?
 *   · is what they can see the latest thing I did?
 *
 * A card that answers only the first calls a page with a week of unpublished
 * edits "Published", which is true and useless. One that answers only the
 * second calls a brand-new page and a freshly-edited live page the same thing.
 *
 * Hence four states over three dots. The dot is the first question — green
 * means a visitor can see it — and the words are the second. Never the colour
 * alone: a green dot and an amber dot are the same dot to a good number of
 * people, and to anybody reading it in bright sun.
 */

export type PageState =
  /** A visitor sees it, and what they see is current. */
  | 'live'
  /** A visitor sees it, but not the newest version — the draft has more. */
  | 'changes'
  /** Made here, never published. No visitor has ever seen it. */
  | 'unpublished'
  /** Published once, then switched off in Settings. The address now 404s. */
  | 'hidden'

export const STATE_LABEL: Record<PageState, string> = {
  live: 'Published',
  changes: 'Unpublished changes',
  unpublished: 'Not published',
  hidden: 'Hidden',
}

/** Green / amber / grey. The dot answers "can anybody see this". */
export const STATE_DOT: Record<PageState, 'live' | 'waiting' | 'idle'> = {
  live: 'live',
  changes: 'waiting',
  unpublished: 'idle',
  hidden: 'idle',
}

/** Spelled out for a screen reader, which gets no colour at all. */
export const STATE_TITLE: Record<PageState, string> = {
  live: 'Published — visitors see the current version',
  changes: 'Published, with newer edits waiting to go live',
  unpublished: 'Not published — no visitor has seen this page',
  hidden: 'Hidden — the address does not resolve',
}

/** Is there a version of this page a visitor can reach? */
export function isLive(state: PageState): boolean {
  return state === 'live' || state === 'changes'
}

export type AdminPage = {
  key: string
  label: string
  /** The public address, or null for a page that has none (the 404). */
  path: string | null
  /** Where the editor opens it. */
  editHref: string
  builtin: boolean
  state: PageState
  icon: IconName
  /** True for the site's front page — it gets the house. */
  home: boolean
}

/**
 * Which mark goes beside a page's name.
 *
 * By what the page IS, where that is known, and by a plain document
 * otherwise — a photographer's own page could be anything, and guessing from
 * its title would be wrong about as often as it was right.
 */
export function pageIcon(key: string): IconName {
  switch (key) {
    case 'home':
      return 'home'
    case 'galleries':
      return 'image'
    case 'journal':
      return 'notebook'
    case 'contact':
      return 'mail'
    case 'shop':
      return 'bag'
    default:
      return 'file'
  }
}
