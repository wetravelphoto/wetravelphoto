'use client'

import { useState } from 'react'
import { PLATFORM } from '@/lib/platform'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }

    router.push('/admin')
    router.refresh()
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: '#1a1715',
      }}
    >
      <div style={{ width: '100%', maxWidth: 320 }}>
        <p
          className="display"
          style={{
            fontSize: '0.9rem',
            letterSpacing: '0.12em',
            color: '#f2efe9',
            margin: '0 0 2rem',
            textAlign: 'center',
          }}
        >
          {PLATFORM.name}
        </p>

        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />

          {error && (
            <p style={{ color: '#e08a6d', fontSize: '0.78rem', margin: '0 0 0.75rem' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: '100%',
              padding: '0.7rem',
              background: '#f2efe9',
              color: '#1a1715',
              border: 'none',
              fontFamily: 'var(--font-display), sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontSize: '0.8rem',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem',
  marginBottom: '0.65rem',
  background: 'transparent',
  border: '0.5px solid rgba(242,239,233,0.25)',
  color: '#f2efe9',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
}
