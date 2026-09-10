'use client'

import { useState } from 'react'

export default function TagInput({
  name,
  initialTags,
  suggestions = [],
  placeholder = 'Add a tag…',
  onChange,
}: {
  name: string
  initialTags: string[]
  suggestions?: string[]
  placeholder?: string
  onChange?: (tags: string[]) => void
}) {
  const [tags, setTags] = useState<string[]>(initialTags)
  const [draft, setDraft] = useState('')

  function update(next: string[]) {
    setTags(next)
    onChange?.(next)
  }

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase()
    if (!tag || tags.includes(tag)) {
      setDraft('')
      return
    }
    update([...tags, tag])
    setDraft('')
  }

  function removeTag(tag: string) {
    update(tags.filter((t) => t !== tag))
  }

  const unused = suggestions.filter((s) => !tags.includes(s)).slice(0, 12)

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' }}>
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
              ×
            </button>
          </span>
        ))}
        {tags.length === 0 && (
          <span className="admin-meta" style={{ fontStyle: 'italic' }}>
            No tags yet
          </span>
        )}
      </div>

      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            addTag(draft)
          }
          if (e.key === 'Backspace' && !draft && tags.length) {
            removeTag(tags[tags.length - 1])
          }
        }}
        onBlur={() => draft && addTag(draft)}
        placeholder={placeholder}
        className="admin-input"
        style={{ marginTop: 0 }}
        autoComplete="off"
      />

      {unused.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <p className="admin-meta" style={{ margin: '0 0 0.3rem' }}>
            Used elsewhere — click to add
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {unused.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addTag(s)}
                className="admin-btn admin-btn-sm admin-btn-ghost"
                style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem' }}
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <input type="hidden" name={name} value={tags.join(',')} />
    </div>
  )
}
