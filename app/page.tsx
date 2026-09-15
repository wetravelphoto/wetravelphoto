import { loadPageSections } from '@/lib/sections/load'
import { buildContext } from '@/lib/sections/context'
import { renderSection } from '@/components/sections'
import { heroIsEmpty } from '@/components/sections/HeroSection'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import './home.css'
import './home-polish.css'
import './hero.css'
import './instagram.css'
import './contact-footer.css'

export const revalidate = 60

/**
 * The homepage is now a list, not a layout.
 *
 * Every block on it comes from page_sections in the order stored there — or,
 * until the first save in the editor, from the site_settings columns by way of
 * lib/sections/legacy.ts. Either way this file does not know what a hero or a
 * journal is, which is the point: a new section type never touches it.
 */
export default async function HomePage() {
  const { sections, settings } = await loadPageSections('home')
  const visible = sections.filter((s) => s.visible)

  const ctx = await buildContext(visible, settings)

  // The header goes transparent only when something full-bleed is actually
  // drawn underneath it.
  const hero = visible.find((s) => s.type === 'hero')
  const overHero = !!hero && !heroIsEmpty(hero.settings, ctx)

  return (
    <main>
      <SiteHeader overHero={overHero} />
      {visible.map((section) => renderSection(section, ctx))}
      <SiteFooter />
    </main>
  )
}
