'use client'

import { useState } from 'react'
import TagInput from '@/components/admin/TagInput'
import FeaturedImagePicker from '@/components/admin/FeaturedImagePicker'

export default function PostMetaFields({
  title,
  slug,
  excerpt,
  category,
  categories,
  albumId,
  albums,
  featuredPath,
  tags,
  tagSuggestions,
  publicUrl,
}: {
  title: string
  slug: string
  excerpt: string
  category: string
  categories: string[]
  albumId: string
  albums: { id: string; title: string }[]
  featuredPath: string | null
  tags: string[]
  tagSuggestions: string[]
  publicUrl: string
}) {
  const [cat, setCat] = useState(category)

  return (
    <div className="admin-panel">
      <h2 className="admin-h2">Details</h2>

      <label className="admin-field">
        Title
        <input type="text" name="title" defaultValue={title} className="admin-input" />
      </label>

      <label className="admin-field">
        URL slug
        <input type="text" name="slug" defaultValue={slug} className="admin-input" />
        <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
          /journal/{slug}
        </span>
      </label>

      <label className="admin-field">
        Category
        <input
          type="text"
          name="category"
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          placeholder="e.g. Field Notes, Gear, Expedition"
          className="admin-input"
          list="category-options"
        />
        <datalist id="category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>

      <label className="admin-field">
        Excerpt
        <textarea
          name="excerpt"
          defaultValue={excerpt}
          rows={3}
          placeholder="One or two sentences — shown on the journal index and in link previews."
          className="admin-input"
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </label>

      <FeaturedImagePicker initialPath={featuredPath} publicUrl={publicUrl} />

      <label className="admin-field">
        Linked trip album (optional)
        <select name="album_id" defaultValue={albumId} className="admin-select">
          <option value="">None</option>
          {albums.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
          Adds a &ldquo;view album&rdquo; link at the end of the story.
        </span>
      </label>

      <div className="admin-field">
        Tags
        <div style={{ marginTop: '0.4rem' }}>
          <TagInput name="tags" initialTags={tags} suggestions={tagSuggestions} />
        </div>
      </div>
    </div>
  )
}
