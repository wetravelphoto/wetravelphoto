import { buildContext } from '@/lib/sections/context'
import { renderSection } from '@/components/sections'
import { heroIsEmpty } from '@/components/sections/HeroSection'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import type { LoadedSection } from '@/lib/sections/load'
import type { SiteSettings } from '@/lib/site'

/**
 * THE PAGE, DRAWN ONCE
 * ════════════════════
 *
 * Both the live site and the editor's preview render through this component.
 * Not for tidiness — because a preview that renders through a second, parallel
 * implementation will eventually disagree with the real page, and a canvas you
 * cannot trust is worse than no canvas. There is one tree. The only difference
 * between the two callers is where the sections came from and whether each one
 * is tagged so it can be clicked.
 *
 * `selectable` adds a wrapper per section carrying its id. The wrapper is a
 * plain block with no styles of its own, and nothing in the site's CSS uses
 * child or sibling selectors on these elements, so the preview lays out
 * identically to the live page. If that ever stops being true, the fix is to
 * remove the wrapper and tag the section elements themselves — not to let the
 * preview drift.
 */
export default async function PageBody({
  sections,
  settings,
  selectable = false,
}: {
  sections: LoadedSection[]
  settings: SiteSettings
  selectable?: boolean
}) {
  const visible = sections.filter((s) => s.visible)
  const ctx = await buildContext(visible, settings)

  // The header goes transparent only when something full-bleed is actually
  // drawn underneath it.
  const hero = visible.find((s) => s.type === 'hero')
  const overHero = !!hero && !heroIsEmpty(hero.settings, ctx)

  return (
    <main>
      <SiteHeader overHero={overHero} />

      {visible.map((section) =>
        selectable ? (
          <div
            key={section.id}
            className="pv-section"
            data-section-id={section.id}
            data-section-type={section.type}
          >
            {/* A real element rather than a ::before, because the wrapper's
                two pseudo-elements are already spoken for: one is the click
                target that sits over the section's own links, the other draws
                the outline. */}
            <span className="pv-tag" aria-hidden="true">
              {section.def.label}
            </span>
            {renderSection(section, ctx)}
          </div>
        ) : (
          renderSection(section, ctx)
        )
      )}

      <SiteFooter />
    </main>
  )
}
