'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { bulkUpdateStatus, bulkDelete, duplicatePosts } from '@/app/actions/blog'

type Row = {
  id: string
  title: string
  slug: string
  category: string | null
  status: string
  published_at: string | null
  created_at: string
  author: string
}

export default function JournalTable({ posts }: { posts: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const router = useRouter()

  const allSelected = posts.length > 0 && selected.size === posts.length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(posts.map((p) => p.id)))
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    await action()
    setBusy(false)
    setSelected(new Set())
    setConfirmDelete(false)
    router.refresh()
  }

  const ids = Array.from(selected)

  return (
    <>
      {selected.size > 0 && (
        <div
          className="admin-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
            marginBottom: '0.75rem',
            padding: '0.7rem 1rem',
          }}
        >
          <span className="admin-meta" style={{ marginRight: 'auto' }}>
            {selected.size} selected
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => bulkUpdateStatus(ids, 'published'))}
            className="admin-btn admin-btn-sm admin-btn-ghost"
          >
            Publish
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => bulkUpdateStatus(ids, 'draft'))}
            className="admin-btn admin-btn-sm admin-btn-ghost"
          >
            Unpublish
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => duplicatePosts(ids))}
            className="admin-btn admin-btn-sm admin-btn-ghost"
          >
            Duplicate
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirmDelete ? run(() => bulkDelete(ids)) : setConfirmDelete(true))}
            onBlur={() => setConfirmDelete(false)}
            className="admin-btn admin-btn-sm admin-btn-danger"
          >
            {confirmDelete ? 'Confirm delete' : 'Delete'}
          </button>
        </div>
      )}

      <div className="admin-panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th style={{ ...head, width: 36 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              {['Title', 'Category', 'Author', 'Date', 'Status'].map((h) => (
                <th key={h} style={head}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => {
              const date = post.published_at ?? post.created_at
              const isSelected = selected.has(post.id)
              return (
                <tr key={post.id} style={{ background: isSelected ? 'rgba(181,96,44,0.05)' : undefined }}>
                  <td style={cell}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(post.id)}
                      aria-label={`Select ${post.title}`}
                    />
                  </td>
                  <td style={cell}>
                    <Link href={`/admin/journal/${post.id}`}>{post.title}</Link>
                  </td>
                  <td style={{ ...cell, color: 'var(--admin-mute)' }}>{post.category || '—'}</td>
                  <td style={{ ...cell, color: 'var(--admin-mute)' }}>{post.author || '—'}</td>
                  <td style={{ ...cell, color: 'var(--admin-mute)', whiteSpace: 'nowrap' }}>
                    {date
                      ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'}
                  </td>
                  <td style={cell}>
                    <span className="admin-tag" data-tone={post.status === 'published' ? 'live' : undefined}>
                      {post.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

const head: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.7rem 1rem',
  borderBottom: '0.5px solid var(--admin-line)',
  fontFamily: 'var(--font-display), sans-serif',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontSize: '0.68rem',
  fontWeight: 400,
  color: 'var(--admin-mute)',
  whiteSpace: 'nowrap',
}

const cell: React.CSSProperties = {
  padding: '0.7rem 1rem',
  borderTop: '0.5px solid var(--admin-line)',
  verticalAlign: 'middle',
}
