'use client'

import { useState } from 'react'
import { unlockAlbum } from '@/app/actions/access'

export default function AlbumPasswordGate({ slug, title }: { slug: string; title: string }) {
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    const result = await unlockAlbum(slug, formData)
    setError(result?.error ?? null)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: 320, textAlign: 'center' }}>
        <p className="eyebrow" style={{ margin: '0 0 0.75rem' }}>
          Private gallery
        </p>
        <h1 className="display" style={{ fontSize: '1.6rem', margin: '0 0 1.5rem' }}>
          {title}
        </h1>
        <form action={handleSubmit}>
          <input
            type="password"
            name="password"
            placeholder="Password"
            required
            style={{
              width: '100%',
              padding: '0.7rem',
              marginBottom: '0.75rem',
              border: '0.5px solid var(--line)',
              background: 'transparent',
              fontFamily: 'inherit',
              fontSize: '0.9rem',
            }}
          />
          {error && (
            <p style={{ color: 'var(--ember)', fontSize: '0.78rem', margin: '0 0 0.75rem' }}>{error}</p>
          )}
          <button
            type="submit"
            className="display"
            style={{
              width: '100%',
              padding: '0.7rem',
              background: 'var(--ink)',
              color: 'var(--surface)',
              border: 'none',
              fontSize: '0.82rem',
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
          >
            View gallery
          </button>
        </form>
      </div>
    </div>
  )
}
