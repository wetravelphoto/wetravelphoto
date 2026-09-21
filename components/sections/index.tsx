import type { SectionSettings } from '@/lib/sections/registry'
import type { LoadedSection } from '@/lib/sections/load'
import type { SectionContext } from '@/lib/sections/context'

import HeroSection from '@/components/sections/HeroSection'
import IntroSection from '@/components/sections/IntroSection'
import GalleriesSection from '@/components/sections/GalleriesSection'
import JournalSection from '@/components/sections/JournalSection'
import InstagramSection from '@/components/sections/InstagramSection'
import ContactBlock from '@/components/sections/ContactBlock'
import MarkSection from '@/components/sections/MarkSection'
import AboutSection from '@/components/sections/AboutSection'
import ShopSection from '@/components/sections/ShopSection'

type SectionProps = { settings: SectionSettings; ctx: SectionContext }

/**
 * Registry key → what draws it.
 *
 * Kept apart from lib/sections/registry.ts on purpose: that file is plain data
 * and gets imported by client components in the admin, and pulling these
 * server components in with it would drag the whole page into the browser
 * bundle.
 *
 * ADDING A SECTION TYPE IS: a def in the registry, a component, a line here.
 */
const RENDERERS: Record<string, (props: SectionProps) => React.ReactNode> = {
  hero: HeroSection,
  mark: MarkSection,
  intro: IntroSection,
  galleries: GalleriesSection,
  journal: JournalSection,
  instagram: InstagramSection,
  contact: ContactBlock,
  about: AboutSection,
  shop: ShopSection,
}

export function renderSection(section: LoadedSection, ctx: SectionContext): React.ReactNode {
  const Renderer = RENDERERS[section.type]
  // A type this release does not draw is skipped, not thrown. See the note in
  // lib/sections/load.ts.
  if (!Renderer) return null

  return <Renderer key={section.id} settings={section.settings} ctx={ctx} />
}
