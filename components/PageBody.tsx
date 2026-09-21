import { buildContext } from '@/lib/sections/context'
import { renderSection } from '@/components/sections'
import { heroIsEmpty } from '@/components/sections/HeroSection'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import type { LoadedSection } from '@/lib/sections/load'
import type { SiteSettings } from '@/lib/site'
import { PAGES, isPage } from '@/lib/sections/pages'
import { pageFrame } from '@/lib/sections/frame'
// Every section's stylesheet, loaded wherever sections are drawn — so a hero
// added to the About page brings its styles with it. app/page.tsx and the
// preview route import the same files; Next includes each once.
import '@/app/home.css'
import '@/app/home-polish.css'
import '@/app/hero.css'
import '@/app/instagram.css'
import '@/app/contact-footer.css'

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
const FILL: React.CSSProperties = { minHeight: '100vh', display: 'flex', flexDirection: 'column' }

/** The preview wrapper of a section that grows: passes the spare height on. */
const GROW: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column' }

export default async function PageBody({
  sections,
  settings,
  selectable = false,
  page,
  query,
}: {
  sections: LoadedSection[]
  settings: SiteSettings
  selectable?: boolean
  /**
   * Which page this is. Decides whether it is laid out as a full-height column
   * (`fill` in lib/sections/pages.ts) and what it wears around its sections
   * (lib/sections/frame.tsx) — decided here, so the live page and the preview
   * can never dress the same page differently.
   */
  page: string
  /** The page's query string, for sections that read it (the print wall's ?c=). */
  query?: Record<string, string | undefined>
}) {
  const visible = sections.filter((s) => s.visible)
  const ctx = await buildContext(visible, settings, { editable: selectable, query })
  const fill = isPage(page) && PAGES[page].fill
  const frame = pageFrame(page, settings)

  // The header goes transparent only when something full-bleed is actually
  // drawn underneath it.
  const hero = visible.find((s) => s.type === 'hero')
  const overHero = !!hero && !heroIsEmpty(hero.settings, ctx)

  return (
    <main className={frame.className} style={{ ...(fill ? FILL : {}), ...frame.style }}>
      {frame.head}
      <SiteHeader overHero={overHero} />

      {visible.map((section) =>
        selectable ? (
          <div
            key={section.id}
            className="pv-section"
            data-section-id={section.id}
            data-section-type={section.type}
            style={fill && section.def.grows ? GROW : undefined}
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

      {frame.after}

      <SiteFooter />
    </main>
  )
}
