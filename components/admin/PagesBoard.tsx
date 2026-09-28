'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import Icon from '@/components/admin/Icon'
import PageCard from '@/components/admin/PageCard'
import { isLive, type AdminPage } from '@/lib/admin/page-status'
import { createDraftPage, deleteDraftPage, updateDraftPage } from '@/app/actions/pages'
import { slugify } from '@/lib/sections/pages'

/**
 * YOUR WEBSITE, AT A GLANCE
 * ═════════════════════════
 *
 * Six or seven cards, each one a miniature of the real page, and the three
 * things you do from here: open one, add one, or publish what you have.
 *
 * ── Why cards and not rows ──────────────────────────────────────────────────
 *
 * The old screen was six rows of title and paragraph. It described the pages
 * accurately and you still had to READ it to find the About page, because
 * every row looked the same. A photographer recognises their own About page
 * from across the room; the interface should let them.
 *
 * ── The counts are counted ──────────────────────────────────────────────────
 *
 * Published is "a visitor can reach a version of this", which includes a page
 * with newer edits waiting — those are two different facts and the card says
 * both. Drafts is the other half: never published, or switched off. The two
 * always add up to All, which is the only property that makes the numbers
 * worth printing.
 */

type Tab = 'all' | 'published' | 'drafts'
type View = 'grid' | 'list'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All pages' },
  { id: 'published', label: 'Published' },
  { id: 'drafts', label: 'Drafts' },
]

/** The visitor's-eye division: can they reach it, or not. */
function inTab(page: AdminPage, tab: Tab): boolean {
  if (tab === 'all') return true
  return tab === 'published' ? isLive(page.state) : !isLive(page.state)
}

/** "yesterday at 4:32 PM", in the reader's own locale and zone. */
function when(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null

  const time = then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const day = new Date(then).setHours(0, 0, 0, 0)
  const today = new Date().setHours(0, 0, 0, 0)
  const days = Math.round((today - day) / 86_400_000)

  if (days === 0) return `today at ${time}`
  if (days === 1) return `yesterday at ${time}`
  if (days < 7) return `${then.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`
  return `${then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${time}`
}

export default function PagesBoard({
  pages,
  host,
  lastPublished,
  hasDraft,
}: {
  pages: AdminPage[]
  /** The address the site is served at, or null if no domain is attached yet. */
  host: string | null
  lastPublished: string | null
  hasDraft: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('all')
  const [view, setView] = useState<View>('grid')
  const [find, setFind] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  /** The rename dialog, or the new-page dialog, or nothing. */
  const [naming, setNaming] = useState<{ page: AdminPage | null } | null>(null)

  const counts = useMemo(
    () => ({
      all: pages.length,
      published: pages.filter((p) => isLive(p.state)).length,
      drafts: pages.filter((p) => !isLive(p.state)).length,
    }),
    [pages]
  )

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase()
    return pages.filter(
      (p) =>
        inTab(p, tab) &&
        (needle === '' ||
          p.label.toLowerCase().includes(needle) ||
          (p.path ?? '').toLowerCase().includes(needle))
    )
  }, [pages, tab, find])

  const run = (work: () => Promise<unknown>) => {
    setError(null)
    startTransition(async () => {
      try {
        await work()
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That did not work.')
      }
    })
  }

  return (
    <div className="pb">
      <header className="pb-head">
        <div className="pb-head-words">
          <h1 className="pb-title">Your website, at a glance.</h1>
          <p className="pb-sub">Manage your pages, refine your story, and decide what goes live.</p>

          <p className="pb-site">
            {host ? (
              <Link href={`https://${host}`} target="_blank" rel="noreferrer" className="pb-host">
                {host}
                <Icon name="external" size={13} />
              </Link>
            ) : (
              /* No domain is attached to this site yet. Saying so beats
                 printing the platform's own address as though it were
                 theirs. */
              <span className="pb-host pb-host-none">No address yet</span>
            )}

            {host && (
              <span className="pb-live">
                <span className="pc-dot" data-tone={hasDraft ? 'waiting' : 'live'} aria-hidden />
                {hasDraft ? 'Live, with unpublished changes' : 'Live'}
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          className="lg-btn pb-new"
          disabled={pending}
          onClick={() => setNaming({ page: null })}
        >
          <Icon name="plus" size={15} />
          New page
        </button>
      </header>

      {error && (
        <p role="alert" className="pb-error">
          {error}
        </p>
      )}

      <div className="pb-bar">
        <div className="pb-tabs" role="tablist" aria-label="Which pages to show">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="pb-tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="pb-tab-count">{counts[t.id]}</span>
            </button>
          ))}
        </div>

        <div className="pb-tools">
          <label className="pb-find">
            <Icon name="search" size={15} />
            <span className="cv-sr">Find a page</span>
            <input
              type="search"
              value={find}
              placeholder="Find a page…"
              onChange={(e) => setFind(e.target.value)}
            />
          </label>

          <div className="pb-view" role="group" aria-label="How to show the pages">
            {(['grid', 'list'] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                className="pb-view-btn"
                data-on={view === v || undefined}
                aria-pressed={view === v}
                aria-label={v === 'grid' ? 'Show as cards' : 'Show as a list'}
                onClick={() => setView(v)}
              >
                <Icon name={v} size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="pb-empty">
          <p className="pb-empty-head">
            {find.trim() ? `Nothing matches “${find.trim()}”.` : 'Nothing here yet.'}
          </p>
          <p className="pb-empty-note">
            {find.trim()
              ? 'Try part of a page’s name or its address.'
              : tab === 'drafts'
                ? 'Every page on this site is published.'
                : 'Add a page and it will appear here.'}
          </p>
        </div>
      ) : (
        <div className="pb-grid" data-view={view}>
          {shown.map((page) => (
            <PageCard
              key={page.key}
              page={page}
              view={view}
              // A built-in page's name and address are fixed by the routes
              // that serve them, so only the photographer's own can be
              // renamed or removed.
              onRename={page.builtin ? undefined : (p) => setNaming({ page: p })}
              onDelete={
                page.builtin
                  ? undefined
                  : (p) => {
                      if (
                        confirm(
                          `Delete “${p.label}”? Its sections and settings go with it. This is saved to your draft, so Discard still undoes it.`
                        )
                      ) {
                        run(() => deleteDraftPage(p.key))
                      }
                    }
              }
            />
          ))}
        </div>
      )}

      <footer className="pb-foot">
        <p className="pb-foot-facts">
          <span>
            {pages.length} {pages.length === 1 ? 'page' : 'pages'}
          </span>
          <span className="lg-crumb-sep" aria-hidden>
            ·
          </span>
          <span>
            {lastPublished
              ? `Last published ${when(lastPublished)}`
              : 'Not published yet'}
          </span>
        </p>

        {/* The menu is edited in the page editor, which is the only place it
            exists. This goes there rather than to a screen that is not built. */}
        <Link href="/edit/home?menu=1" className="pb-foot-link">
          Manage site navigation
          <Icon name="chevron-right" size={14} />
        </Link>
      </footer>

      {naming && (
        <NameDialog
          page={naming.page}
          busy={pending}
          onClose={() => setNaming(null)}
          onSave={(title, slug) => {
            const page = naming.page
            setNaming(null)
            run(async () => {
              if (page) await updateDraftPage(page.key, { title, slug })
              else {
                const made = await createDraftPage({ title, slug })
                router.push(`/edit/${made.key}`)
              }
            })
          }}
        />
      )}
    </div>
  )
}

/**
 * NAMING A PAGE, AND GIVING IT AN ADDRESS.
 *
 * One dialog for both jobs, because they are the same two fields and the
 * address follows the name until somebody touches it — which is what people
 * expect and what stops a site full of `/page-2`.
 */
function NameDialog({
  page,
  busy,
  onClose,
  onSave,
}: {
  page: AdminPage | null
  busy: boolean
  onClose: () => void
  onSave: (title: string, slug: string) => void
}) {
  const [title, setTitle] = useState(page?.label ?? '')
  const [slug, setSlug] = useState(page?.path?.replace(/^\//, '') ?? '')
  /** Once the address has been typed in, it stops following the name. */
  const [ownSlug, setOwnSlug] = useState(!!page)

  const address = ownSlug ? slug : slugify(title)

  return (
    <div
      className="pb-veil"
      role="dialog"
      aria-modal="true"
      aria-label={page ? `Rename ${page.label}` : 'New page'}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <form
        className="pb-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim() && address) onSave(title.trim(), address)
        }}
      >
        <h2 className="admin-h2" style={{ marginBottom: 4 }}>
          {page ? 'Rename this page' : 'A new page'}
        </h2>
        <p className="admin-meta" style={{ margin: '0 0 16px' }}>
          {page
            ? 'Changing the address moves nothing — the page keeps its sections.'
            : 'It starts with one section, and saves to your draft until you publish.'}
        </p>

        <label className="admin-field">
          Name
          <input
            className="admin-input"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Weddings"
          />
        </label>

        <label className="admin-field">
          Address
          <input
            className="admin-input"
            value={address}
            onChange={(e) => {
              setOwnSlug(true)
              setSlug(slugify(e.target.value))
            }}
            placeholder="weddings"
          />
          <span className="admin-meta">/{address || '…'}</span>
        </label>

        <div className="pb-dialog-foot">
          <button type="button" className="lg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="lg-btn lg-btn-primary"
            disabled={busy || !title.trim() || !address}
          >
            {busy ? 'Saving…' : page ? 'Save' : 'Create page'}
          </button>
        </div>
      </form>
    </div>
  )
}
