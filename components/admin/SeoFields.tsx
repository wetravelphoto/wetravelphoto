'use client'

import { useState } from 'react'

const TITLE_MAX = 60
const DESC_MAX = 155

export default function SeoFields({
  seoTitle,
  seoDescription,
  noindex,
  fallbackTitle,
  fallbackDescription,
  slug,
  host,
}: {
  seoTitle: string
  seoDescription: string
  noindex: boolean
  fallbackTitle: string
  fallbackDescription: string
  slug: string
  /** This site's own address, so the preview shows theirs and not somebody else's. */
  host: string
}) {
  const [title, setTitle] = useState(seoTitle)
  const [desc, setDesc] = useState(seoDescription)

  const shownTitle = title || fallbackTitle
  const shownDesc = desc || fallbackDescription

  function counter(value: string, max: number) {
    const over = value.length > max
    return (
      <span
        className="admin-meta"
        style={{ color: over ? 'var(--admin-danger)' : undefined, float: 'right' }}
      >
        {value.length} / {max}
      </span>
    )
  }

  return (
    <div className="admin-panel" style={{ marginTop: '1.25rem' }}>
      <h2 className="admin-h2">Search &amp; sharing</h2>

      {/* Rough preview of how the result reads in Google */}
      <div style={{ border: '0.5px solid var(--admin-line)', padding: '0.85rem', marginBottom: '1rem', background: 'var(--admin-bg)' }}>
        <p style={{ margin: 0, fontSize: '0.7rem', color: '#3a7d3a' }}>
          {host} › journal › {slug}
        </p>
        <p style={{ margin: '0.2rem 0', fontSize: '1rem', color: '#1a0dab', lineHeight: 1.3 }}>
          {shownTitle.slice(0, 70) || 'Page title'}
        </p>
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#4d5156', lineHeight: 1.5 }}>
          {shownDesc.slice(0, 165) || 'Add a description to control how this story appears in search results.'}
        </p>
      </div>

      <label className="admin-field">
        SEO title {counter(title, TITLE_MAX)}
        <input
          type="text"
          name="seo_title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={fallbackTitle}
          className="admin-input"
        />
        <span className="admin-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
          Leave blank to use the story title.
        </span>
      </label>

      <label className="admin-field">
        Meta description {counter(desc, DESC_MAX)}
        <textarea
          name="seo_description"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={3}
          placeholder={fallbackDescription || 'A short summary for search engines and link previews.'}
          className="admin-input"
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
        <span className="admin-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
          Leave blank to use the excerpt.
        </span>
      </label>

      <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input type="checkbox" name="noindex" defaultChecked={noindex} />
        Hide this story from search engines
      </label>
    </div>
  )
}
