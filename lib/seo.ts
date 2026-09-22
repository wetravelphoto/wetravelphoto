import type { Metadata } from 'next'
import { PAGES, isPage } from '@/lib/sections/pages'
import { str } from '@/lib/sections/registry'
import type { LoadedSection } from '@/lib/sections/load'
import type { SiteSettings } from '@/lib/site'
import { photoUrl } from '@/lib/images'

/**
 * SEARCH AND SHARING, PER PAGE
 * ════════════════════════════
 *
 * What Google shows for a page (its title and description), what a link to it
 * looks like when shared (the image), and whether search engines should list
 * it at all. Edited in the canvas, with the page's other settings: click the
 * empty space beside the sections, or "Page settings" at the top of the list.
 *
 * Stored per page in site_settings.page_seo, and in the draft until Publish,
 * like everything else the canvas edits.
 *
 * EVERY FIELD IS OPTIONAL. Anything left empty is worked out from the page
 * itself, exactly as it was before this existed: the title from the page's
 * main heading, the description from the site's tagline, the image from the
 * first photograph on the page, then the homepage's share image. So a
 * photographer who never opens this panel still gets sensible results, and the
 * panel shows those automatic values as its placeholders.
 *
 * Pure: no database, no request. Used by the public routes, the sitemap and
 * the editor.
 */

export type PageSeo = {
  /** The title in search results and in the browser tab. */
  title?: string
  /** The description in search results and on a shared link. */
  description?: string
  /** A storage key (like every image in the site), not a URL. */
  image?: string
  /** Ask search engines not to list this page. */
  noindex?: boolean
}

export type PageSeoMap = Record<string, PageSeo>

/** Past these, search engines cut the text off. Shown as counters in the panel. */
export const TITLE_LIMIT = 60
export const DESCRIPTION_LIMIT = 160

// Hard caps on what is stored — well past what is useful, short of abuse.
const TITLE_MAX = 120
const DESCRIPTION_MAX = 320
const KEY = /^[A-Za-z0-9][A-Za-z0-9_\-./]{0,300}$/

/**
 * One page's values, cleaned. Everything arrives from a browser or from a
 * JSON column, so nothing is trusted for its shape: a value of the wrong type
 * is dropped, never coerced.
 */
export function sanitizePageSeo(input: unknown): PageSeo {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const raw = input as Record<string, unknown>
  const out: PageSeo = {}

  const text = (v: unknown, max: number) =>
    typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''

  const title = text(raw.title, TITLE_MAX)
  if (title) out.title = title

  const description = text(raw.description, DESCRIPTION_MAX)
  if (description) out.description = description

  // A storage key only: no scheme, no "..", nothing that could point outside
  // the site's own photographs.
  if (typeof raw.image === 'string' && KEY.test(raw.image) && !raw.image.includes('..')) {
    out.image = raw.image
  }

  if (raw.noindex === true) out.noindex = true
  return out
}

/** Every page's values, cleaned. Unknown pages are dropped. */
export function sanitizeSeoMap(input: unknown): PageSeoMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: PageSeoMap = {}
  for (const [page, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isPage(page)) continue
    const clean = sanitizePageSeo(value)
    if (Object.keys(clean).length) out[page] = clean
  }
  return out
}

/** One page's stored values. */
export function readPageSeo(settings: Pick<SiteSettings, 'page_seo'>, page: string): PageSeo {
  return sanitizePageSeo((settings.page_seo ?? {})[page])
}

// ── Working it out from the page ─────────────────────────────────────────────

/**
 * Each page's main section type, whose heading has always been the page's
 * title — and the word used when that heading is empty. The same rules the
 * routes used before this file existed, so nothing changes for a page that
 * sets nothing.
 */
const MAIN: Record<string, { type: string | null; fallback: string }> = {
  home: { type: null, fallback: '' },
  about: { type: 'about', fallback: 'About' },
  contact: { type: null, fallback: 'Contact' },
  journal: { type: 'journal', fallback: 'Journal' },
  galleries: { type: 'galleries', fallback: 'Galleries' },
  shop: { type: 'shop', fallback: 'Prints' },
}

function mainSection(page: string, sections: LoadedSection[]): LoadedSection | undefined {
  const type = MAIN[page]?.type
  return type ? sections.find((s) => s.type === type && s.visible) : undefined
}

/** The page's title before the " — Site name" part. Empty for the homepage. */
function autoTitle(page: string, sections: LoadedSection[]): string {
  const main = mainSection(page, sections)
  return (main && str(main.settings, 'heading')) || MAIN[page]?.fallback || ''
}

function autoDescription(page: string, sections: LoadedSection[], settings: SiteSettings): string {
  if (page === 'shop') {
    const wall = mainSection(page, sections)
    const sub = wall ? str(wall.settings, 'subheading') : null
    return sub ?? settings.shop_intro ?? settings.tagline ?? ''
  }
  return settings.tagline ?? `Photographs by ${settings.site_title}.`
}

/** The first photograph drawn on the page, in order: any image setting. */
function firstPhoto(sections: LoadedSection[]): string | null {
  for (const section of sections) {
    if (!section.visible) continue
    for (const field of section.def.fields) {
      if (field.kind !== 'image') continue
      const value = str(section.settings, field.key)
      if (value) return value
    }
  }
  return null
}

export type ResolvedSeo = {
  /** What goes in the tab and the search result, site name included. */
  fullTitle: string
  /** The title without the site name — what a shared link shows. */
  shareTitle: string
  description: string
  /** The share image's storage key, if there is one. */
  image: string | null
  /** Where that image came from, so the panel can say so. */
  imageFrom: 'page' | 'photo' | 'site' | null
  noindex: boolean
  /** The values used for any field left empty — the panel's placeholders. */
  auto: {
    title: string
    description: string
    shareTitle: string
    image: string | null
    imageFrom: 'photo' | 'site' | null
  }
}

/**
 * The tab and search-result title for a title typed into the panel: as typed,
 * with the site's name after it — except on the homepage, where the name is
 * usually the title, or when the photographer already wrote it in.
 */
export function composeTitle(page: string, typed: string, site: string): string {
  return page === 'home' || typed.includes(site) ? typed : `${typed} — ${site}`
}

/**
 * Everything search engines and shared links will see for a page.
 *
 * The homepage's share image stands in for any page that has neither its own
 * nor a photograph on it (the journal and galleries grids, the contact form).
 */
export function resolveSeo(
  page: string,
  sections: LoadedSection[],
  settings: SiteSettings
): ResolvedSeo {
  const own = readPageSeo(settings, page)
  const site = settings.site_title

  const baseTitle = autoTitle(page, sections)
  const autoFull = page === 'home' || !baseTitle ? site : `${baseTitle} — ${site}`
  // A title typed for the page is used as typed, with the site's name after it
  // — except on the homepage, where the name usually IS the title.
  const fullTitle = own.title ? composeTitle(page, own.title, site) : autoFull

  const autoDesc = autoDescription(page, sections, settings)

  const photo = firstPhoto(sections)
  const siteImage = readPageSeo(settings, 'home').image ?? null
  // The homepage's own image IS the site's, so it cannot fall back to itself.
  const [autoImage, autoFrom]: [string | null, 'photo' | 'site' | null] = photo
    ? [photo, 'photo']
    : siteImage && page !== 'home'
      ? [siteImage, 'site']
      : [null, null]
  const [image, imageFrom]: [string | null, ResolvedSeo['imageFrom']] = own.image
    ? [own.image, 'page']
    : [autoImage, autoFrom]

  const autoShare = page === 'home' ? site : baseTitle || site

  return {
    fullTitle,
    shareTitle: own.title || autoShare,
    description: own.description || autoDesc,
    image,
    imageFrom,
    noindex: own.noindex === true,
    auto: {
      title: autoFull,
      description: autoDesc,
      shareTitle: autoShare,
      image: autoImage,
      imageFrom: autoFrom,
    },
  }
}

/** Next.js metadata for one of the editor's pages. */
export function pageMetadata(
  page: string,
  sections: LoadedSection[],
  settings: SiteSettings
): Metadata {
  const seo = resolveSeo(page, sections, settings)
  const path = isPage(page) ? PAGES[page].path : '/'
  const images = seo.image ? [{ url: photoUrl(seo.image) }] : undefined

  return {
    // `absolute`, so the layout's own title does not get appended a second time.
    title: { absolute: seo.fullTitle },
    description: seo.description || undefined,
    alternates: { canonical: path },
    robots: seo.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: 'website',
      url: path,
      siteName: settings.site_title,
      title: seo.shareTitle,
      description: seo.description || undefined,
      images,
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title: seo.shareTitle,
      description: seo.description || undefined,
      images: images?.map((i) => i.url),
    },
  }
}
