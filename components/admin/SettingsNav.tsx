'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import Icon from '@/components/admin/Icon'
import { SETTINGS_SECTIONS, searchSections } from '@/lib/admin/settings-sections'

/**
 * THE SECOND NAVIGATION
 * ═════════════════════
 *
 * The rail on the far left says which part of the workspace you are in. This
 * one says which part of Settings. It is the only thing on this screen that has
 * to run in the browser, and it runs for one reason: the search box.
 *
 * ── Why it filters rather than jumps ────────────────────────────────────────
 *
 * Typing narrows the list and leaves the choosing to the person. A search that
 * navigates on the first keystroke takes the screen away from under you, and
 * one that shows results in a floating panel means learning a second way to
 * open a section. Here there is one list, and the search makes it shorter.
 *
 * ── Why the active section is a prop ────────────────────────────────────────
 *
 * The page already read `?s=` on the server to decide which panels to render.
 * Reading it again here with `useSearchParams` would be a second source for one
 * fact, and the two can disagree for a frame. One answer, passed down.
 */
export default function SettingsNav({ active }: { active: string }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchSections(query), [query])

  return (
    <nav className="st-nav" aria-label="Settings sections">
      <div className="st-find">
        <Icon name="search" size={15} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a setting…"
          aria-label="Find a setting"
          className="st-find-input"
        />
        {query && (
          <button
            type="button"
            className="st-find-clear"
            onClick={() => setQuery('')}
            aria-label="Clear the search"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {/* Counted, so a search that found nothing says so rather than drawing an
          empty column. */}
      {results.length === 0 ? (
        <p className="st-nav-none">
          Nothing in Settings matches “{query}”.
          <br />
          {SETTINGS_SECTIONS.length} sections are searched by name and by the settings inside them.
        </p>
      ) : (
        <ul className="st-nav-list">
          {results.map(({ section, hit }) => (
            <li key={section.id}>
              {section.soon ? (
                <span className="lg-nav-item st-nav-item" data-soon title={section.soon} aria-disabled>
                  <Icon name={section.icon} size={17} />
                  <span className="lg-nav-name">{section.label}</span>
                  <span className="lg-nav-soon">Soon</span>
                </span>
              ) : (
                <Link
                  href={`/admin/settings?s=${section.id}`}
                  className="lg-nav-item st-nav-item"
                  aria-current={section.id === active ? 'page' : undefined}
                  scroll={false}
                >
                  <Icon name={section.icon} size={17} />
                  <span className="lg-nav-name">
                    {section.label}
                    {/* What matched, when it was not the name. */}
                    {hit && <span className="st-nav-hit">{hit}</span>}
                  </span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
