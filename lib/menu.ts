import { findPage, isPageKey, type CustomPage } from '@/lib/sections/pages'
import type { SiteSettings } from '@/lib/site'

/**
 * THE SITE'S MENU
 * ═══════════════
 *
 * An ordered list the photographer builds in the editor (Pages & menu):
 *
 *   page    one of the site's pages, by key. Its label follows the page unless
 *           one is typed here, so renaming a page renames its menu entry.
 *   link    anywhere else: an Instagram profile, a booking form. Opens in a new
 *           tab when asked to.
 *   folder  a heading with pages and links under it — a dropdown on a wide
 *           screen, an indented group on a phone. One level only: menus with
 *           folders inside folders are hard to use on any screen.
 *
 * Stored in site_settings.menu, and in the draft until Publish. NULL means it
 * has never been set, and the menu is built the way it always was (see
 * legacyMenu), so a site that never opens the menu editor sees no change.
 *
 * Pure: used by the header on the server and by the editor in the browser.
 */

export type MenuPageItem = { id: string; kind: 'page'; page: string; label?: string }
export type MenuLinkItem = { id: string; kind: 'link'; label: string; url: string; newTab?: boolean }
export type MenuLeaf = MenuPageItem | MenuLinkItem
export type MenuFolder = { id: string; kind: 'folder'; label: string; children: MenuLeaf[] }
export type MenuItem = MenuLeaf | MenuFolder

/** What the header draws: every page resolved to an address and a label. */
export type NavLink = {
  id: string
  label: string
  href: string
  /** Leaves the site: opened with rel="noopener", and in a new tab if asked. */
  external: boolean
  newTab: boolean
  /** A folder's entries. A folder itself has no address (href is ''). */
  children?: NavLink[]
}

const MAX_ITEMS = 24
const MAX_CHILDREN = 16
const LABEL_MAX = 40
const ID = /^[a-z0-9_-]{1,24}$/i

/** A fresh id for a menu entry. */
export function newMenuId(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return `m${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)}`
}

/**
 * A link address that is safe to put in the menu, or null. Web addresses,
 * email and phone links, and paths on this site. Never `javascript:` or a
 * `data:` URL, whatever the capitalisation or leading spaces.
 */
export function cleanUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const url = input.trim()
  if (!url || url.length > 500) return null
  if (url.startsWith('/') && !url.startsWith('//')) return url
  if (/^mailto:[^\s]+$/i.test(url) || /^tel:[+\d\s().-]+$/i.test(url)) return url
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

const label = (v: unknown) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX) : ''

function cleanLeaf(raw: Record<string, unknown>, id: string): MenuLeaf | null {
  if (raw.kind === 'page') {
    if (!isPageKey(raw.page)) return null
    const text = label(raw.label)
    return { id, kind: 'page', page: raw.page, ...(text ? { label: text } : {}) }
  }
  if (raw.kind === 'link') {
    const url = cleanUrl(raw.url)
    const text = label(raw.label)
    if (!url || !text) return null
    return { id, kind: 'link', label: text, url, ...(raw.newTab === true ? { newTab: true } : {}) }
  }
  return null
}

/**
 * The stored menu, cleaned. Null stays null ("never set"); anything else is
 * rebuilt entry by entry, dropping what does not fit the shape — a folder
 * inside a folder, a link with a `javascript:` address, a duplicate id.
 */
export function sanitizeMenu(input: unknown): MenuItem[] | null {
  if (input === null || input === undefined) return null
  if (!Array.isArray(input)) return null

  const seen = new Set<string>()
  const idFor = (v: unknown) => {
    const id = typeof v === 'string' && ID.test(v) && !seen.has(v) ? v : newMenuId()
    seen.add(id)
    return id
  }

  const out: MenuItem[] = []
  for (const entry of input.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Record<string, unknown>
    const id = idFor(raw.id)

    if (raw.kind === 'folder') {
      const text = label(raw.label)
      if (!text) continue
      const children: MenuLeaf[] = []
      for (const child of Array.isArray(raw.children) ? raw.children.slice(0, MAX_CHILDREN) : []) {
        if (!child || typeof child !== 'object') continue
        const c = child as Record<string, unknown>
        const leaf = cleanLeaf(c, idFor(c.id))
        if (leaf) children.push(leaf)
      }
      out.push({ id, kind: 'folder', label: text, children })
      continue
    }

    const leaf = cleanLeaf(raw, id)
    if (leaf) out.push(leaf)
  }
  return out
}

/**
 * The menu every site had before it could be edited: Galleries, Journal,
 * Prints (when the shop is open), About (when it is shown), Contact. Used
 * whenever no menu has been saved, and as the starting point the editor
 * offers the first time it is opened.
 */
export function legacyMenu(): MenuItem[] {
  return [
    { id: 'galleries', kind: 'page', page: 'galleries' },
    { id: 'journal', kind: 'page', page: 'journal' },
    { id: 'shop', kind: 'page', page: 'shop' },
    { id: 'about', kind: 'page', page: 'about' },
    { id: 'contact', kind: 'page', page: 'contact' },
  ]
}

type MenuSettings = Pick<
  SiteSettings,
  | 'show_about'
  | 'show_shop'
  | 'nav_galleries_label'
  | 'nav_journal_label'
  | 'nav_about_label'
  | 'nav_contact_label'
  | 'nav_shop_label'
>

/**
 * The label a page shows in the menu when none is typed: the menu labels from
 * Settings → Menu for the built-in pages (as before), the page's own title for
 * the photographer's pages.
 */
export function defaultPageLabel(key: string, settings: MenuSettings, custom: CustomPage[]): string {
  switch (key) {
    case 'home':
      return 'Home'
    case 'galleries':
      return settings.nav_galleries_label || 'Galleries'
    case 'journal':
      return settings.nav_journal_label || 'Journal'
    case 'about':
      return settings.nav_about_label || 'About'
    case 'contact':
      return settings.nav_contact_label || 'Contact'
    case 'shop':
      return settings.nav_shop_label || 'Prints'
    default:
      return custom.find((p) => p.key === key)?.title ?? ''
  }
}

/**
 * Whether a page can be linked to right now. A page the photographer switched
 * off (About, a closed shop) or deleted drops out of the menu rather than
 * leading to a "not found".
 */
function pageIsLive(key: string, settings: MenuSettings, custom: CustomPage[]): boolean {
  if (key === 'about') return settings.show_about !== false
  if (key === 'shop') return settings.show_shop === true
  return findPage(key, custom) !== null
}

/**
 * The menu as the header draws it. `menu` null means "never set" and gives
 * the legacy menu. Folders left with nothing live in them are dropped.
 */
export function resolveMenu(
  menu: MenuItem[] | null,
  settings: MenuSettings,
  custom: CustomPage[]
): NavLink[] {
  const leaf = (item: MenuLeaf): NavLink | null => {
    if (item.kind === 'page') {
      if (!pageIsLive(item.page, settings, custom)) return null
      const page = findPage(item.page, custom)
      if (!page) return null
      return {
        id: item.id,
        label: item.label || defaultPageLabel(item.page, settings, custom),
        href: page.path,
        external: false,
        newTab: false,
      }
    }
    const external = !item.url.startsWith('/')
    return { id: item.id, label: item.label, href: item.url, external, newTab: item.newTab === true }
  }

  const out: NavLink[] = []
  for (const item of menu ?? legacyMenu()) {
    if (item.kind === 'folder') {
      const children = item.children.map(leaf).filter((l): l is NavLink => l !== null)
      if (children.length) {
        out.push({ id: item.id, label: item.label, href: '', external: false, newTab: false, children })
      }
      continue
    }
    const link = leaf(item)
    if (link) out.push(link)
  }
  return out
}
