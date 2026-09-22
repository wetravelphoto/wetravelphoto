import { buildContext } from '@/lib/sections/context'
import { renderSection } from '@/components/sections'
import { heroIsEmpty } from '@/components/sections/HeroSection'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import type { LoadedSection } from '@/lib/sections/load'
import type { SiteSettings } from '@/lib/site'
import { findPage, sanitizeCustomPages } from '@/lib/sections/pages'
import { pageFrame } from '@/lib/sections/frame'
// Every section's stylesheet, loaded wherever sections are drawn — so a hero
// added to the About page brings its styles with it. app/page.tsx and the
// preview route import the same files; Next includes each once.
import '@/app/home.css'
import '@/app/home-polish.css'
import '@/app/hero.css'
import '@/app/instagram.css'
import '@/app/contact-footer.css'
import '@/app/sections-common.css'

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
/**
 * A section's spacing, background and visibility, as the attributes and one
 * custom property that app/sections-common.css turns into CSS. The section's
 * own stylesheet reads them with its old value as the fallback, so "Default"
 * changes nothing.
 */
function frameAttrs(settings: Record<string, unknown>): {
  attrs: Record<string, string>
  style: React.CSSProperties
} {
  const pick = (key: string, allowed: string[], fallback: string) => {
    const v = settings[key]
    return typeof v === 'string' && allowed.includes(v) ? v : fallback
  }
  const space = ['default', 'none', 's', 'm', 'l', 'xl']
  const bg = pick('background', ['default', 'page', 'alt', 'tint', 'custom'], 'default')
  const color = typeof settings.bg_color === 'string' && /^#[0-9a-f]{6}$/i.test(settings.bg_color)
    ? settings.bg_color
    : null

  return {
    attrs: {
      'data-space-top': pick('space_top', space, 'default'),
      'data-space-bottom': pick('space_bottom', space, 'default'),
      'data-bg': bg,
      'data-hide': pick('hide_on', ['none', 'mobile', 'desktop'], 'none'),
    },
    style: color ? ({ '--sec-bg-custom': color } as React.CSSProperties) : {},
  }
}

/** The fields whose value the editor can paint onto the wrapper as it changes. */
const WRAPPER_LIVE = 'space_top space_bottom background bg_color hide_on'

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
  const fill = findPage(page, sanitizeCustomPages(settings.custom_pages))?.fill ?? false
  const frame = pageFrame(page, settings)

  // The header goes transparent only when something full-bleed is actually
  // drawn underneath it.
  const hero = visible.find((s) => s.type === 'hero')
  const overHero = !!hero && !heroIsEmpty(hero.settings, ctx)

  return (
    <main className={frame.className} style={{ ...(fill ? FILL : {}), ...frame.style }}>
      {frame.head}
      {/* The settings this page was drawn with, so the preview's menu is the
          draft's menu — new pages, new order — and not the live one. */}
      <SiteHeader overHero={overHero} settings={settings} />

      {visible.map((section) => {
        const wrap = frameAttrs(section.settings)

        return selectable ? (
          <div
            key={section.id}
            className="pv-section"
            data-section-id={section.id}
            data-section-type={section.type}
            data-live={WRAPPER_LIVE}
            {...wrap.attrs}
            style={{ ...(fill && section.def.grows ? GROW : {}), ...wrap.style }}
          >
            {/* A real element rather than a ::before, because the wrapper's
                two pseudo-elements are already spoken for: one is the click
                target that sits over the section's own links, the other draws
                the outline. */}
            <span className="pv-tag" aria-hidden="true">
              {section.def.label}
            </span>
            {renderSection(section, ctx)}
            {/* Shown only on the selected section (preview.css). The bridge
                turns a click into an "add after this id" message. */}
            <button type="button" className="pv-add" data-add-after={section.id}>
              + Add a section below
            </button>
          </div>
        ) : (
          // display: contents — no box, no layout change; it only carries the
          // attributes and custom property the section reads.
          <div key={section.id} className="sec-wrap" {...wrap.attrs} style={wrap.style}>
            {renderSection(section, ctx)}
          </div>
        )
      })}

      {frame.after}

      <SiteFooter settings={settings} />
    </main>
  )
}
