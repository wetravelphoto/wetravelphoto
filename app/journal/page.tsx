import type { Metadata } from 'next'
import { loadPageSections } from '@/lib/sections/load'
import { str } from '@/lib/sections/registry'
import { PAGES } from '@/lib/sections/pages'
import PageBody from '@/components/PageBody'

export const revalidate = 60

/**
 * The Journal page is a list of sections, edited in the canvas at
 * /edit/journal. Until its first Publish it is drawn by lib/sections/legacy.ts
 * as it always was: the journal section in its grid layout — every story, the
 * newest drawn large.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { sections, settings } = await loadPageSections('journal')
  const journal = sections.find((s) => s.type === 'journal' && s.visible)
  const heading = journal ? str(journal.settings, 'heading') : null

  return {
    title: `${heading || 'Journal'} — ${settings.site_title}`,
    description: settings.tagline ?? undefined,
  }
}

export default async function JournalPage() {
  const { sections, settings } = await loadPageSections('journal')

  return <PageBody sections={sections} settings={settings} fill={PAGES.journal.fill} />
}
