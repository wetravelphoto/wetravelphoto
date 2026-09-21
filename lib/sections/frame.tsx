import type { SiteSettings } from '@/lib/site'
import { wallStyle, googleFontHref } from '@/lib/wall'

/**
 * WHAT A PAGE WEARS AROUND ITS SECTIONS
 * ═════════════════════════════════════
 *
 * Most pages are just their sections between the header and the footer. The
 * shop is not: the whole page is a wall — a texture behind everything, a
 * heading typeface chosen for it, a quote across the foot — and all three are
 * shared with each print's own page, which the canvas does not edit. So they
 * are not settings of any one section; they are the page's frame, read from
 * Shop settings and applied around the sections.
 *
 * PageBody asks for the frame by page slug, so the live page and the editor's
 * preview dress a page identically — there is one place this is decided.
 */
export type PageFrame = {
  className?: string
  style?: React.CSSProperties
  /** Rendered first inside <main>: stylesheets the frame depends on. */
  head?: React.ReactNode
  /** Rendered after the sections, before the footer. */
  after?: React.ReactNode
}

export function pageFrame(page: string, settings: SiteSettings): PageFrame {
  if (page !== 'shop') return {}

  const fontHref = googleFontHref(settings.shop_title_font)

  return {
    className: 'wall shop-page',
    style: wallStyle(settings),
    // The wall's typeface is the owner's choice, so it is fetched at runtime
    // the same way the gallery covers fetch theirs.
    head: fontHref ? <link rel="stylesheet" href={fontHref} /> : null,
    after: settings.shop_quote ? (
      <section className="wall-quote">
        <div className="shop-inner">
          <p className="wall-quote-text">{settings.shop_quote}</p>
          {settings.shop_quote_by && <p className="wall-quote-by">— {settings.shop_quote_by}</p>}
        </div>
      </section>
    ) : null,
  }
}
