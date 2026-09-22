/**
 * THE PAGES THE EDITOR CAN OPEN
 * ═════════════════════════════
 *
 * Two kinds, drawn by the same machinery:
 *
 * BUILT-IN pages (below): the homepage, About, Contact, Journal, Galleries and
 * Shop. Each has its own public route and, until its first Publish, a legacy
 * mapping from the old site_settings columns (lib/sections/legacy.ts).
 *
 * THE PHOTOGRAPHER'S OWN pages ("Weddings", "Workshops"), created in the
 * editor. Stored as a list in site_settings.custom_pages (and in the draft
 * until Publish), served at /<slug> by app/[slug]/page.tsx.
 *
 * A page is identified by its KEY everywhere that stores something about it
 * (page_sections.page, page_seo, the draft). For a built-in page the key is its
 * name ('about'); for one of the photographer's it is a generated id
 * ('p_4k9x2m7q'). The address (`slug`) is separate, so renaming a page's
 * address moves nothing: its sections stay filed under the same key.
 *
 * Pure data and pure functions: imported by server code and by the canvas.
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
  // Its wall, typeface and closing quote come from Shop settings, applied
  // around the sections by lib/sections/frame.tsx.
  shop: { label: 'Shop', path: '/shop', fill: true },
} as const

export type PageSlug = keyof typeof PAGES

export const PAGE_SLUGS = Object.keys(PAGES) as PageSlug[]

/** A BUILT-IN page. For "any page, including the photographer's", use findPage. */
export function isPage(value: unknown): value is PageSlug {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PAGES, value)
}

// ── The photographer's own pages ─────────────────────────────────────────────

export type CustomPage = {
  /** Where its sections and settings are filed. Never changes. */
  key: string
  /** Its address: /<slug>. */
  slug: string
  /** Its name, in the editor and (by default) in the menu. */
  title: string
}

/** Every page, of either kind, as the editor and the menu see it. */
export type SitePage = {
  key: string
  label: string
  path: string
  fill: boolean
  builtin: boolean
}

export const CUSTOM_KEY = /^p_[a-z0-9]{8}$/
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/
export const MAX_CUSTOM_PAGES = 40

/**
 * Addresses a page cannot take: every top-level route the app already has,
 * and a few that would be confusing or that Next.js and the web reserve.
 */
const RESERVED = new Set([
  'about', 'contact', 'journal', 'trips', 'shop', 'gallery', 'galleries', 'home',
  'admin', 'edit', 'preview', 'api', 'login', 'logout', 'signup', 'account',
  'sitemap', 'sitemap.xml', 'robots', 'robots.txt', 'favicon', 'favicon.ico',
  'static', 'public', 'assets', 'images', 'img', 'media', 'files', 'cdn',
  'index', 'search', 'feed', 'rss', 'blog', 'cart', 'checkout', 'order', 'orders',
  'well-known', '_next', 'auth', 'g', 's', 'share', 'lensgrid', 'review',
])

/** A title turned into an address: "Weddings & Elopements" → "weddings-elopements". */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

/** Why an address cannot be used, or null when it can. */
export function slugProblem(slug: string, pages: CustomPage[], ownKey?: string): string | null {
  if (!slug) return 'Give the page an address.'
  if (!SLUG.test(slug)) return 'Use lowercase letters, numbers and dashes only.'
  if (RESERVED.has(slug)) return `“/${slug}” is already used by the site. Try another address.`
  if (pages.some((p) => p.slug === slug && p.key !== ownKey)) {
    return `Another page already uses “/${slug}”.`
  }
  return null
}

/** A fresh key. Random, so two editors can never mint the same one. */
export function newPageKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return `p_${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`
}

/**
 * The stored list, cleaned. It arrives from a JSON column or a browser, so
 * every entry is checked; a bad one is dropped, as is a second use of a key or
 * an address.
 */
export function sanitizeCustomPages(input: unknown): CustomPage[] {
  if (!Array.isArray(input)) return []
  const out: CustomPage[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const { key, slug, title } = raw as Record<string, unknown>
    if (typeof key !== 'string' || !CUSTOM_KEY.test(key)) continue
    if (typeof slug !== 'string' || typeof title !== 'string') continue
    const cleanTitle = title.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!cleanTitle) continue
    if (slugProblem(slug, out)) continue
    if (out.some((p) => p.key === key)) continue
    out.push({ key, slug, title: cleanTitle })
    if (out.length >= MAX_CUSTOM_PAGES) break
  }
  return out
}

/** Built-in pages first, in their usual order, then the photographer's own. */
export function sitePages(custom: CustomPage[]): SitePage[] {
  return [
    ...PAGE_SLUGS.map((key) => ({
      key,
      label: PAGES[key].label,
      path: PAGES[key].path,
      fill: PAGES[key].fill,
      builtin: true,
    })),
    ...custom.map((p) => ({ key: p.key, label: p.title, path: `/${p.slug}`, fill: true, builtin: false })),
  ]
}

/** One page by key, of either kind, or null. */
export function findPage(key: string, custom: CustomPage[]): SitePage | null {
  return sitePages(custom).find((p) => p.key === key) ?? null
}

/**
 * Whether a string could be a page key at all — for cleaning stored maps keyed
 * by page (page_seo), where the list of pages is not at hand.
 */
export function isPageKey(value: unknown): value is string {
  return typeof value === 'string' && (isPage(value) || CUSTOM_KEY.test(value))
}
