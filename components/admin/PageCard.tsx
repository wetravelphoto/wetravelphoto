'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/admin/Icon'
import PageThumb from '@/components/admin/PageThumb'
import {
  STATE_DOT,
  STATE_LABEL,
  STATE_TITLE,
  type AdminPage,
} from '@/lib/admin/page-status'

/**
 * ONE PAGE, AS A PAGE
 * ═══════════════════
 *
 * ── The picture is the actual page ──────────────────────────────────────────
 *
 * Not a cover photograph, and not a diagram of one. The card shows
 * `/preview/<key>?thumb=1` — the same route the editor previews through,
 * rendered by the same components the live site uses — in an iframe scaled
 * down to card size.
 *
 * The alternative was a second, simpler renderer that draws an impression of
 * each page from its section list. It would have been cheaper and it would
 * have been wrong: the moment somebody adds a section type the miniature
 * renderer has not been taught, the card shows a page that does not exist.
 * This cannot drift, because there is nothing for it to drift from.
 *
 * The cost is honest and paid down where it can be: nothing in a thumbnail is
 * clickable, no film plays, nothing animates (app/preview/preview.css), and
 * the iframes load lazily so a card scrolled past is never rendered at all.
 *
 * ── One target, not forty ───────────────────────────────────────────────────
 *
 * The whole preview is a single link to the editor, and the "Open editor"
 * chip that appears over it on hover is a SPAN — it looks like a button and is
 * deliberately not one, because a button inside a link is a control whose
 * behaviour depends on which pixel you hit.
 *
 * The ellipsis is outside that link, in the footer, for the same reason — and
 * so it can never be confused with the miniature website's own navigation,
 * which is a real menu drawn a few pixels above it.
 */

export default function PageCard({
  page,
  /** Rename this page. Absent for a built-in page, which cannot be renamed. */
  onRename,
  onDelete,
  view,
}: {
  page: AdminPage
  onRename?: (page: AdminPage) => void
  onDelete?: (page: AdminPage) => void
  view: 'grid' | 'list'
}) {
  const [menu, setMenu] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setMenu(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [menu])

  const preview = (
    <Link href={page.editHref} className="pc-shot" aria-label={`Open the editor for ${page.label}`}>
      <PageThumb page={page.key} />

      {/* Looks like a button, is not one: a button inside a link is a control
          whose behaviour depends on which pixel you hit. */}
      <span className="pc-open" aria-hidden>
        Open editor
        <Icon name="external" size={13} />
      </span>
    </Link>
  )

  return (
    <article className="pc" data-view={view} data-home={page.home || undefined}>
      {preview}

      <div className="pc-foot" ref={box}>
        <span className="pc-kind" aria-hidden>
          <Icon name={page.icon} size={16} />
        </span>

        <span className="pc-id">
          <span className="pc-name">{page.label}</span>
          <span className="pc-path">{page.path ?? 'No address — shown in place of a missing page'}</span>
        </span>

        <span className="pc-state" title={STATE_TITLE[page.state]}>
          <span className="pc-dot" data-tone={STATE_DOT[page.state]} aria-hidden />
          {STATE_LABEL[page.state]}
        </span>

        <div className="ad-menu-wrap">
          <button
            type="button"
            className="ad-ico pc-more"
            aria-label={`Actions for ${page.label}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <Icon name="more" />
          </button>

          {menu && (
            <div className="ad-menu" data-at="down-end" role="menu">
              <Link href={page.editHref} className="ad-menu-item" role="menuitem">
                <Icon name="design" size={15} />
                Open editor
              </Link>

              {onRename && (
                <button
                  type="button"
                  className="ad-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false)
                    onRename(page)
                  }}
                >
                  <Icon name="file" size={15} />
                  Rename and address…
                </button>
              )}

              {/*
                * Search and sharing live in the page's own panel in the
                * editor, which is where this goes — rather than a second
                * screen that would be a second place to keep in step.
                */}
              <Link href={`${page.editHref}?panel=seo`} className="ad-menu-item" role="menuitem">
                <Icon name="settings" size={15} />
                Page settings
              </Link>

              {page.path && (
                <Link
                  href={page.path}
                  target="_blank"
                  rel="noreferrer"
                  className="ad-menu-item"
                  role="menuitem"
                >
                  <Icon name="external" size={15} />
                  View live page
                </Link>
              )}

              {onDelete && (
                <>
                  <div className="ad-menu-sep" />
                  <button
                    type="button"
                    className="ad-menu-item"
                    role="menuitem"
                    data-danger
                    onClick={() => {
                      setMenu(false)
                      onDelete(page)
                    }}
                  >
                    Delete page
                  </button>
                </>
              )}

              {/*
                * DUPLICATE AND SET-AS-HOMEPAGE ARE NOT BUILT.
                *
                * There is no action behind either one: `home` is a fixed
                * built-in key (lib/sections/pages.ts) and nothing can point it
                * at another page, and the only duplicate in the codebase
                * copies a SECTION. Drawing them as working menu items would
                * be found out on the first click, so they are not drawn.
                */}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
