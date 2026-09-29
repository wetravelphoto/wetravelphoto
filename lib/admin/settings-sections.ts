import type { IconName } from '@/components/admin/Icon'

/**
 * WHAT IS IN SETTINGS, AND WHAT IS NOT
 * ════════════════════════════════════
 *
 * Settings was one column of eleven panels, about 2,400 pixels tall. Finding
 * the public email address meant scrolling past the menu labels and the
 * Instagram token, and there was no way to link anyone to a particular setting.
 *
 * So it becomes a list of sections beside the panels of one section — a second
 * navigation inside the screen. This file is the list, kept apart from both the
 * navigation that draws it and the page that renders the panels, because both
 * need to agree on the ids and neither should own them.
 *
 * ── Why the ids are in the URL ──────────────────────────────────────────────
 *
 * `?s=contact` rather than component state: the browser's Back button then
 * works, a section can be linked to from somewhere else in the workspace, and
 * the panels stay server-rendered — the only thing that has to run in the
 * browser is the search box.
 *
 * ── Why `finds` exists ──────────────────────────────────────────────────────
 *
 * Nobody looks for "Integrations". They look for "instagram", and before that
 * for "favicon", "copyright", "unsubscribe". A search that matches only the
 * twelve section names is a search that fails on the first word anybody types,
 * so each section carries the words for the settings inside it.
 *
 * ── `soon` is not a link to nowhere ─────────────────────────────────────────
 *
 * Three of these have nothing behind them in this build. They are listed,
 * greyed and marked — the same rule the rail uses (components/admin/
 * AdminSidebar.tsx). Listing them shows the shape of the product; linking them
 * to an empty screen teaches the photographer that this workspace lies.
 *
 * Each one is a `soon` line to delete when its panels land.
 */

export type SettingsSection = {
  id: string
  label: string
  icon: IconName
  /** The line under the heading, saying what this group is for. */
  blurb: string
  /** The names of the settings inside, for the search box. Lowercase. */
  finds: string[]
  /** Set when there is nothing behind it yet. Shown on hover. */
  soon?: string
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'general',
    label: 'General',
    icon: 'settings',
    blurb: 'What the site is called, and the small picture on the browser tab.',
    finds: ['site name', 'title', 'owner name', 'your name', 'site icon', 'favicon', 'tab icon', 'header', 'footer', 'logo', 'copyright'],
  },
  {
    id: 'contact',
    label: 'Contact & social',
    icon: 'share',
    blurb: 'How people reach you, and where else you post.',
    finds: ['tagline', 'public email', 'email address', 'instagram url', 'facebook', 'youtube', 'social links'],
  },
  {
    id: 'email',
    label: 'Email notifications',
    icon: 'bell',
    blurb: 'Where messages from the contact form are sent.',
    finds: ['contact form', 'notifications', 'enquiries', 'inquiries', 'reply to', 'notify'],
  },
  {
    id: 'menu',
    label: 'Navigation & menu',
    icon: 'navigation',
    blurb: 'What each page is called in the header and footer.',
    finds: ['menu', 'navigation', 'labels', 'galleries', 'journal', 'about', 'contact', 'prints', 'hide about'],
  },
  {
    id: 'domains',
    label: 'Domains',
    icon: 'domains',
    blurb: 'The address the site is served at.',
    finds: ['domain', 'dns', 'custom address', 'url', 'www', 'ssl', 'https'],
    soon: 'Custom domains are not part of this build yet.',
  },
  {
    id: 'seo',
    label: 'Search & sharing',
    icon: 'search',
    blurb: 'How each page looks to Google and in a link preview.',
    finds: ['seo', 'google', 'meta description', 'share image', 'open graph', 'link preview', 'sitemap'],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: 'link',
    blurb: 'Other services this site pulls from.',
    finds: ['instagram', 'instagram feed', 'token', 'handle', 'connect', 'sync'],
  },
  {
    id: 'newsletter',
    label: 'Newsletter',
    icon: 'send',
    blurb: 'Where sign-ups go, and how many are waiting.',
    finds: ['newsletter', 'subscribers', 'sign-ups', 'signups', 'mailing list', 'mailchimp', 'buttondown', 'double opt-in'],
  },
  {
    id: 'team',
    label: 'Team & permissions',
    icon: 'clients',
    blurb: 'Who can sign in to this site.',
    finds: ['team', 'editors', 'permissions', 'roles', 'invite', 'users', 'access'],
  },
  {
    id: 'locale',
    label: 'Language & region',
    icon: 'language',
    blurb: 'The language of the site, and how dates are written.',
    finds: ['language', 'locale', 'region', 'timezone', 'time zone', 'date format', 'translation'],
    soon: 'The site is English-only in this build.',
  },
  {
    id: 'privacy',
    label: 'Privacy & security',
    icon: 'shield',
    blurb: 'Cookies, analytics consent, and signing in.',
    finds: ['privacy', 'cookies', 'consent', 'gdpr', 'analytics', 'password', 'two-factor', 'security'],
    soon: 'Nothing here is configurable yet — see the notes in the section.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: 'sliders',
    blurb: 'Maintenance jobs, and things that are rarely touched.',
    finds: ['photograph sizes', 'image sizes', 'rebuild', 'backfill', 'reprocess', 'thumbnails'],
  },
]

/** The section an `?s=` value means. Anything unrecognised is General. */
export function sectionFor(value: string | string[] | undefined): SettingsSection {
  const want = Array.isArray(value) ? value[0] : value
  // A section with nothing behind it cannot be opened by typing its id either.
  const found = SETTINGS_SECTIONS.find((s) => s.id === want && !s.soon)
  return found ?? SETTINGS_SECTIONS[0]
}

/**
 * Which sections a search matches, and which of their settings did the
 * matching — so the result says WHY it is a result. "favicon" under General is
 * the difference between a search that looks broken and one that works.
 */
export function searchSections(query: string): { section: SettingsSection; hit: string | null }[] {
  const q = query.trim().toLowerCase()
  if (!q) return SETTINGS_SECTIONS.map((section) => ({ section, hit: null }))

  const out: { section: SettingsSection; hit: string | null }[] = []
  for (const section of SETTINGS_SECTIONS) {
    if (section.label.toLowerCase().includes(q)) {
      out.push({ section, hit: null })
      continue
    }
    const hit = section.finds.find((f) => f.includes(q))
    if (hit) out.push({ section, hit })
    else if (section.blurb.toLowerCase().includes(q)) out.push({ section, hit: null })
  }
  return out
}
