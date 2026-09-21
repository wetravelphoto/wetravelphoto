/**
 * THE PAGES THE EDITOR CAN OPEN
 * ═════════════════════════════
 *
 * Each of these is a list of sections in page_sections (or, until its first
 * Publish, one derived from the old site_settings columns by
 * lib/sections/legacy.ts). The canvas, the preview route, the public routes and
 * every canvas action read this one list, so adding a page is an entry here, a
 * legacy mapping, and a public route that renders PageBody.
 *
 * Pure data: imported by server code and by the canvas in the browser.
 *
 * `fill` lays the page out as a full-height column, so a short page still puts
 * the footer at the bottom of the window. The homepage does not use it: its
 * sections are stacked blocks whose spacing relies on ordinary margins, and a
 * flex column would change how those margins meet.
 */
export const PAGES = {
  home: { label: 'Homepage', path: '/', fill: false },
  about: { label: 'About', path: '/about', fill: true },
  contact: { label: 'Contact', path: '/contact', fill: true },
  journal: { label: 'Journal', path: '/journal', fill: true },
  // The slug is what the editor calls it; the public address has always been
  // /trips, and links to it are out in the world.
  galleries: { label: 'Galleries', path: '/trips', fill: true },
} as const

export type PageSlug = keyof typeof PAGES

export const PAGE_SLUGS = Object.keys(PAGES) as PageSlug[]

export function isPage(value: unknown): value is PageSlug {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PAGES, value)
}
