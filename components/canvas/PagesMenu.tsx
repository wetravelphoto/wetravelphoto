'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createDraftPage, deleteDraftPage, saveDraftMenu, updateDraftPage } from '@/app/actions/pages'
import { slugify, type CustomPage, type SitePage } from '@/lib/sections/pages'
import { cleanUrl, newMenuId, type MenuFolder, type MenuItem, type MenuLeaf } from '@/lib/menu'

/** Menu edits are saved this long after the last change, like typing elsewhere. */
const MENU_DEBOUNCE_MS = 500

/**
 * PAGES & MENU
 * ════════════
 *
 * Two lists side by side:
 *
 *   Pages — every page the site has. The photographer's own can be renamed
 *   (name and address) or deleted; new ones start here. Built-in pages are
 *   listed for opening, and can be switched off in Settings as before.
 *
 *   Menu — what the header shows, in order: pages, links elsewhere, and
 *   folders (one level) that open as a dropdown. Arranged with the arrows,
 *   because a list this short does not need drag and drop, and arrows work
 *   the same with a keyboard.
 *
 * Everything writes to the draft (app/actions/pages.ts): nothing reaches the
 * live site before Publish, and each change is one Undo step.
 */
export default function PagesMenu({
  currentPage,
  pages,
  customPages,
  menu: initialMenu,
  menuLabels,
  pagesOff,
  onClose,
  onChanged,
  onOpen,
}: {
  currentPage: string
  pages: SitePage[]
  customPages: CustomPage[]
  menu: MenuItem[]
  menuLabels: Record<string, string>
  pagesOff: string[]
  onClose: () => void
  /** Something was saved: refresh the preview and the editor's data. */
  onChanged: () => void
  /** Open a page in the editor (closes this window). */
  onOpen: (key: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Pages ──

  const [newTitle, setNewTitle] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [editing, setEditing] = useState<{ key: string; title: string; slug: string } | null>(null)

  const act = (work: () => Promise<unknown>, after?: () => void) => {
    setError(null)
    startTransition(async () => {
      try {
        await work()
        onChanged()
        after?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.')
      }
    })
  }

  const create = () => {
    const title = newTitle.trim()
    if (!title) return
    setError(null)
    startTransition(async () => {
      try {
        const { key } = await createDraftPage({ title, slug: newSlug || slugify(title) })
        onChanged()
        onOpen(key)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create the page.')
      }
    })
  }

  // ── Menu ──

  const [menu, setMenu] = useState<MenuItem[]>(initialMenu)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queued = useRef<MenuItem[] | null>(null)

  const flushMenu = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const next = queued.current
    queued.current = null
    if (next) act(() => saveDraftMenu(next))
  }

  // Closing with a change still waiting: save it rather than drop it.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      if (queued.current) saveDraftMenu(queued.current).catch(() => {})
    }
  }, [])

  /** Change the menu: shown at once, saved after a pause (or now). */
  const change = (next: MenuItem[], now = false) => {
    setMenu(next)
    queued.current = next
    if (timer.current) clearTimeout(timer.current)
    if (now) flushMenu()
    else timer.current = setTimeout(flushMenu, MENU_DEBOUNCE_MS)
  }

  const inMenu = new Set(
    menu.flatMap((item) =>
      item.kind === 'folder'
        ? item.children.filter((c) => c.kind === 'page').map((c) => (c as { page: string }).page)
        : item.kind === 'page'
          ? [item.page]
          : []
    )
  )
  const addable = pages.filter((p) => !inMenu.has(p.key))

  // Where an entry is: at the top level (child = null) or inside a folder.
  type At = { index: number; child: number | null }

  const update = (at: At, patch: Partial<MenuLeaf> | Partial<MenuFolder>, now = false) => {
    change(
      menu.map((item, i) => {
        if (i !== at.index) return item
        if (at.child === null) return { ...item, ...patch } as MenuItem
        const folder = item as MenuFolder
        return {
          ...folder,
          children: folder.children.map((c, j) => (j === at.child ? ({ ...c, ...patch } as MenuLeaf) : c)),
        }
      }),
      now
    )
  }

  const remove = (at: At) => {
    if (at.child === null) change(menu.filter((_, i) => i !== at.index), true)
    else {
      change(
        menu.map((item, i) =>
          i === at.index
            ? { ...(item as MenuFolder), children: (item as MenuFolder).children.filter((_, j) => j !== at.child) }
            : item
        ),
        true
      )
    }
  }

  const move = (at: At, by: -1 | 1) => {
    if (at.child === null) {
      const to = at.index + by
      if (to < 0 || to >= menu.length) return
      const next = [...menu]
      ;[next[at.index], next[to]] = [next[to], next[at.index]]
      change(next, true)
      return
    }
    const folder = menu[at.index] as MenuFolder
    const to = at.child + by
    if (to < 0 || to >= folder.children.length) return
    const children = [...folder.children]
    ;[children[at.child], children[to]] = [children[to], children[at.child]]
    change(menu.map((item, i) => (i === at.index ? { ...folder, children } : item)), true)
  }

  /** A top-level page or link, into the folder just above it. */
  const indent = (index: number) => {
    const folder = menu[index - 1]
    const item = menu[index]
    if (!folder || folder.kind !== 'folder' || item.kind === 'folder') return
    const next = menu.filter((_, i) => i !== index)
    next[index - 1] = { ...folder, children: [...folder.children, item] }
    change(next, true)
  }

  /** An entry inside a folder, back out to just after the folder. */
  const outdent = (at: At) => {
    if (at.child === null) return
    const folder = menu[at.index] as MenuFolder
    const item = folder.children[at.child]
    const next = [...menu]
    next[at.index] = { ...folder, children: folder.children.filter((_, j) => j !== at.child) }
    next.splice(at.index + 1, 0, item)
    change(next, true)
  }

  const pageFor = (key: string) => pages.find((p) => p.key === key)

  const leafRow = (leaf: MenuLeaf, at: At, siblings: number, canIndent: boolean) => {
    const page = leaf.kind === 'page' ? pageFor(leaf.page) : null
    const off = leaf.kind === 'page' && pagesOff.includes(leaf.page)

    return (
      <li key={leaf.id} className="cv-menu-row" data-child={at.child !== null}>
        <div className="cv-menu-main">
          <span className="cv-menu-arrows">
            <button type="button" className="cv-ico" onClick={() => move(at, -1)} disabled={(at.child ?? at.index) === 0} aria-label="Move up">
              ↑
            </button>
            <button type="button" className="cv-ico" onClick={() => move(at, 1)} disabled={(at.child ?? at.index) === siblings - 1} aria-label="Move down">
              ↓
            </button>
          </span>

          <input
            type="text"
            className="cv-menu-label"
            value={leaf.label ?? ''}
            placeholder={leaf.kind === 'page' ? menuLabels[leaf.page] || page?.label : 'Label'}
            maxLength={40}
            onChange={(e) => update(at, { label: e.target.value })}
            aria-label="Menu label"
          />

          <span className="cv-menu-tools">
            {at.child === null && canIndent && (
              <button type="button" className="cv-ico" onClick={() => indent(at.index)} title="Put in the folder above" aria-label="Put in the folder above">
                →
              </button>
            )}
            {at.child !== null && (
              <button type="button" className="cv-ico" onClick={() => outdent(at)} title="Take out of the folder" aria-label="Take out of the folder">
                ←
              </button>
            )}
            <button type="button" className="cv-ico cv-ico-bad" onClick={() => remove(at)} title="Remove from the menu" aria-label="Remove from the menu">
              ×
            </button>
          </span>
        </div>

        {leaf.kind === 'page' ? (
          <p className="cv-menu-meta">
            Page · {page?.path ?? 'deleted'}
            {off && <span className="cv-menu-warn"> · switched off in Settings, so not shown</span>}
          </p>
        ) : (
          <div className="cv-menu-link">
            <input
              type="text"
              value={leaf.url}
              placeholder="https://…"
              onChange={(e) => update(at, { url: e.target.value })}
              aria-label="Link address"
            />
            <label className="cv-menu-check">
              <input
                type="checkbox"
                checked={leaf.newTab === true}
                onChange={(e) => update(at, { newTab: e.target.checked }, true)}
              />
              New tab
            </label>
            {(!cleanUrl(leaf.url) || !leaf.label?.trim()) && (
              <span className="cv-menu-warn cv-menu-link-warn">
                Not saved yet: a link needs a label and a full address (https://…, mailto:… or /a-page).
              </span>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="cv-modal" role="dialog" aria-modal="true" aria-label="Pages and menu" onClick={onClose}>
      <div className="cv-modal-box cv-pm" onClick={(e) => e.stopPropagation()}>
        <div className="cv-modal-head">
          <div>
            <h2>Pages &amp; menu</h2>
            <p className="cv-modal-sub">
              Changes go to the draft, like everything in the editor: they reach the live site when
              you Publish, and Undo takes them back.
            </p>
          </div>
          <button type="button" className="cv-ico" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="cv-insp-error">{error}</p>}

        <div className="cv-pm-body" data-busy={pending}>
          {/* ── Pages ── */}
          <section className="cv-pm-col">
            <p className="cv-family-name">Pages</p>
            <ul className="cv-pm-pages">
              {pages.map((p) => {
                const own = customPages.find((c) => c.key === p.key)
                const isEditing = editing?.key === p.key

                return (
                  <li key={p.key} className="cv-pm-page" data-on={p.key === currentPage}>
                    {isEditing && editing ? (
                      <div className="cv-pm-edit">
                        <input
                          type="text"
                          value={editing.title}
                          maxLength={80}
                          onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                          aria-label="Page name"
                        />
                        <span className="cv-pm-slug">
                          /
                          <input
                            type="text"
                            value={editing.slug}
                            maxLength={60}
                            onChange={(e) => setEditing({ ...editing, slug: slugify(e.target.value) || e.target.value.toLowerCase() })}
                            aria-label="Page address"
                          />
                        </span>
                        {own && editing.slug !== own.slug && (
                          <span className="cv-pm-hint">
                            Links to the old address will stop working once published.
                          </span>
                        )}
                        <span className="cv-pm-actions">
                          <button
                            type="button"
                            className="cv-btn"
                            disabled={pending}
                            onClick={() =>
                              act(
                                () => updateDraftPage(p.key, { title: editing.title, slug: editing.slug }),
                                () => setEditing(null)
                              )
                            }
                          >
                            Save
                          </button>
                          <button type="button" className="cv-btn cv-btn-ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </span>
                      </div>
                    ) : (
                      <>
                        <span className="cv-pm-name">
                          {p.label}
                          <span className="cv-pm-path">{p.path}</span>
                        </span>
                        <span className="cv-pm-actions">
                          {p.key !== currentPage && (
                            <button type="button" className="cv-btn cv-btn-ghost" onClick={() => onOpen(p.key)}>
                              Open
                            </button>
                          )}
                          {own ? (
                            <>
                              <button
                                type="button"
                                className="cv-btn cv-btn-ghost"
                                onClick={() => setEditing({ key: own.key, title: own.title, slug: own.slug })}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                className="cv-btn cv-btn-ghost cv-btn-bad"
                                disabled={pending}
                                onClick={() => {
                                  if (confirm(`Delete the ${own.title} page? It stays live until you Publish, and Undo brings it back.`)) {
                                    act(() => deleteDraftPage(own.key), () => {
                                      if (own.key === currentPage) onOpen('home')
                                    })
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </>
                          ) : (
                            <span className="cv-pm-tag">Built in</span>
                          )}
                        </span>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>

            <form
              className="cv-pm-new"
              onSubmit={(e) => {
                e.preventDefault()
                create()
              }}
            >
              <p className="cv-family-name">New page</p>
              <input
                type="text"
                value={newTitle}
                placeholder="Name, e.g. Weddings"
                maxLength={80}
                onChange={(e) => {
                  setNewTitle(e.target.value)
                  if (!slugTouched) setNewSlug(slugify(e.target.value))
                }}
                aria-label="New page name"
              />
              <span className="cv-pm-slug">
                /
                <input
                  type="text"
                  value={newSlug}
                  placeholder="address"
                  maxLength={60}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                  }}
                  aria-label="New page address"
                />
              </span>
              <button type="submit" className="cv-btn cv-btn-go" disabled={pending || !newTitle.trim()}>
                Create page
              </button>
              <span className="cv-pm-hint">It is added to the end of the menu, and opens in the editor.</span>
            </form>
          </section>

          {/* ── Menu ── */}
          <section className="cv-pm-col">
            <p className="cv-family-name">Menu</p>
            <ul className="cv-menu">
              {menu.map((item, index) =>
                item.kind === 'folder' ? (
                  <li key={item.id} className="cv-menu-row cv-menu-folder">
                    <div className="cv-menu-main">
                      <span className="cv-menu-arrows">
                        <button type="button" className="cv-ico" onClick={() => move({ index, child: null }, -1)} disabled={index === 0} aria-label="Move up">
                          ↑
                        </button>
                        <button type="button" className="cv-ico" onClick={() => move({ index, child: null }, 1)} disabled={index === menu.length - 1} aria-label="Move down">
                          ↓
                        </button>
                      </span>
                      <input
                        type="text"
                        className="cv-menu-label"
                        value={item.label}
                        placeholder="Folder name"
                        maxLength={40}
                        onChange={(e) => update({ index, child: null }, { label: e.target.value })}
                        aria-label="Folder name"
                      />
                      <span className="cv-menu-tools">
                        <button
                          type="button"
                          className="cv-ico cv-ico-bad"
                          onClick={() => {
                            // Its entries are kept, moved out to where the folder was.
                            const next = [...menu]
                            next.splice(index, 1, ...item.children)
                            change(next, true)
                          }}
                          title="Remove the folder (keeps what is in it)"
                          aria-label="Remove the folder"
                        >
                          ×
                        </button>
                      </span>
                    </div>
                    <p className="cv-menu-meta">
                      Folder · opens as a dropdown
                      {item.children.length === 0 && ' · empty, so not shown: use → on an entry below it'}
                    </p>
                    {item.children.length > 0 && (
                      <ul className="cv-menu cv-menu-children">
                        {item.children.map((child, j) =>
                          leafRow(child, { index, child: j }, item.children.length, false)
                        )}
                      </ul>
                    )}
                  </li>
                ) : (
                  leafRow(item, { index, child: null }, menu.length, menu[index - 1]?.kind === 'folder')
                )
              )}
            </ul>

            <div className="cv-pm-add">
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return
                  change([...menu, { id: newMenuId(), kind: 'page', page: e.target.value }], true)
                }}
                aria-label="Add a page to the menu"
                disabled={addable.length === 0}
              >
                <option value="">{addable.length ? '+ Add a page…' : 'Every page is in the menu'}</option>
                {addable.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="cv-btn cv-btn-ghost"
                onClick={() => change([...menu, { id: newMenuId(), kind: 'link', label: 'Link', url: 'https://' }])}
              >
                + Link
              </button>
              <button
                type="button"
                className="cv-btn cv-btn-ghost"
                onClick={() => change([...menu, { id: newMenuId(), kind: 'folder', label: 'More', children: [] }], true)}
              >
                + Folder
              </button>
            </div>
            <p className="cv-pm-hint">
              A page&apos;s label follows its name unless you type one. The logo always links to the
              homepage.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
