'use client'

import { useCallback, useEffect, useState } from 'react'
import { PLATFORM } from '@/lib/platform'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * SIGNING IN, AND THE THREE OTHER THINGS THIS PAGE HAS TO BE
 * ══════════════════════════════════════════════════════════
 *
 * This was a sign-in form, and that was enough while the only person who ever
 * used it already had a password. The moment somebody is INVITED it stops
 * being enough, because an invited person has no password and nothing here
 * offered to give them one. The first real invitation landed on this page, the
 * token in the URL was ignored, and the only thing on screen asked for a
 * password that did not exist.
 *
 * So this page is now four things, decided by what is in the address bar:
 *
 *   · **A sign-in form** — the ordinary case, and still the default.
 *   · **Choose your password** — arrived with a valid invitation or reset
 *     token. The session is already established by the time this shows; all
 *     that is left is to pick a password so there is a way back in tomorrow.
 *   · **That link has expired** — said plainly, with the way to fix it right
 *     there, because "Email link is invalid or has expired" in a URL fragment
 *     is not an error message anybody should have to read.
 *   · **Send me a link** — for the expired case and for a forgotten password,
 *     so neither needs somebody with access to the Supabase dashboard.
 *
 * **Why the token handling is written out rather than left to the library.**
 * Supabase's browser client does read tokens out of the URL by itself, and
 * usually that is enough. But it does it silently: if it succeeds this page
 * would not know to ask for a password, and if it fails this page would not
 * know to say so. Both of those are the whole point here. The URL is therefore
 * read BEFORE the client is created, and every shape Supabase can send is
 * handled explicitly:
 *
 *   · `#access_token=…&refresh_token=…` — the implicit flow, what an
 *     invitation currently sends;
 *   · `?code=…` — the PKCE flow;
 *   · `?token_hash=…&type=…` — the newer verification link.
 *
 * Calling `setSession` on tokens the client already consumed is harmless, and
 * being sure beats being tidy.
 *
 * The URL is wiped afterwards with `replaceState`, so an access token is not
 * left sitting in the address bar, in history, or in whatever gets pasted into
 * a chat window when somebody asks for help.
 */

type Mode = 'signin' | 'password' | 'sending' | 'sent'

export default function LoginPage() {
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expired, setExpired] = useState(false)
  const [busy, setBusy] = useState(false)

  // ── What the link brought with it ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    const hash = new URLSearchParams(
      window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
    )
    const query = new URLSearchParams(window.location.search)
    const param = (name: string) => hash.get(name) ?? query.get(name)

    const linkError = param('error') ?? param('error_code')
    const accessToken = param('access_token')
    const refreshToken = param('refresh_token')
    const code = param('code')
    const tokenHash = param('token_hash')
    const type = param('type')

    const hadSomething = Boolean(linkError || accessToken || code || tokenHash)
    if (!hadSomething) return

    // Nothing to do with the address bar once it has been read, and an access
    // token is not something to leave lying in it.
    window.history.replaceState({}, '', window.location.pathname)

    // Everything that follows sets state, and none of it is allowed to happen
    // synchronously inside an effect — so all of it, the error branch
    // included, lives in here.
    void (async () => {
      if (linkError) {
        const why = param('error_description')?.replace(/\+/g, ' ')
        setExpired(
          linkError === 'otp_expired' ||
            linkError === 'access_denied' ||
            Boolean(why?.toLowerCase().includes('expired'))
        )
        setError(
          why && !why.toLowerCase().includes('expired')
            ? why
            : 'That link has expired. They are good for 24 hours and can only be used once.'
        )
        return
      }

      const supabase = createClient()

      try {
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
        } else if (code) {
          await supabase.auth.exchangeCodeForSession(code)
        } else if (tokenHash) {
          await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type === 'recovery' ? 'recovery' : 'invite',
          })
        }
      } catch {
        // Fall through — the session check below is what actually decides.
      }

      const { data } = await supabase.auth.getSession()
      if (cancelled) return

      if (data.session) {
        setMode('password')
        setNotice(
          type === 'recovery'
            ? 'Choose a new password.'
            : 'Welcome. Choose a password and the site is yours.'
        )
      } else {
        setExpired(true)
        setError('That link has expired. They are good for 24 hours and can only be used once.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // ── Signing in ────────────────────────────────────────────────────────────
  const handleSignIn = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError('')
      setBusy(true)

      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

      if (signInError) {
        setError(
          signInError.message === 'Invalid login credentials'
            ? 'That email and password do not match an account. If you were invited and never set a password, use the link below.'
            : signInError.message
        )
        setBusy(false)
        return
      }

      router.push('/admin')
      router.refresh()
    },
    [email, password, router]
  )

  // ── Choosing a password ───────────────────────────────────────────────────
  const handleSetPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError('')

      if (password.length < 8) {
        setError('Use at least 8 characters.')
        return
      }
      if (password !== confirm) {
        setError('Those two do not match.')
        return
      }

      setBusy(true)
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })

      if (updateError) {
        setError(updateError.message)
        setBusy(false)
        return
      }

      router.push('/admin')
      router.refresh()
    },
    [password, confirm, router]
  )

  // ── Asking for a fresh link ───────────────────────────────────────────────
  const handleSendLink = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError('')

      if (!email) {
        setError('Type the email the invitation was sent to.')
        return
      }

      setBusy(true)
      const supabase = createClient()
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/admin/login`,
      })

      // Deliberately the same answer whether or not the address has an
      // account. A sign-in page that says "no such user" tells anybody who
      // asks which addresses are worth guessing a password for.
      setBusy(false)
      setMode('sent')
      setExpired(false)
    },
    [email]
  )

  // ── What is on screen ─────────────────────────────────────────────────────

  const title = {
    signin: 'Sign in',
    password: 'Choose a password',
    sending: 'Send me a link',
    sent: 'Check your email',
  }[mode]

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
            margin: '0 0 0.5rem',
            textAlign: 'center',
          }}
        >
          {PLATFORM.name}
        </p>
        <p style={{ ...metaStyle, textAlign: 'center', margin: '0 0 1.75rem' }}>{title}</p>

        {notice && <p style={{ ...metaStyle, margin: '0 0 1rem' }}>{notice}</p>}

        {error && (
          <p style={{ color: '#e08a6d', fontSize: '0.78rem', margin: '0 0 0.9rem', lineHeight: 1.5 }}>
            {error}
          </p>
        )}

        {/* ── Choose a password ── */}
        {mode === 'password' && (
          <form onSubmit={handleSetPassword}>
            <input
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              minLength={8}
              autoComplete="new-password"
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Again, to be sure"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              style={inputStyle}
            />
            <button type="submit" disabled={busy} style={buttonStyle(busy)}>
              {busy ? 'Saving…' : 'Save and continue'}
            </button>
            <p style={{ ...metaStyle, margin: '0.9rem 0 0' }}>
              At least 8 characters. Nobody else ever sees it, including whoever invited you.
            </p>
          </form>
        )}

        {/* ── Sign in ── */}
        {mode === 'signin' && (
          <form onSubmit={handleSignIn}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={inputStyle}
            />
            <button type="submit" disabled={busy} style={buttonStyle(busy)}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => {
                setError('')
                setNotice('')
                setMode('sending')
              }}
              style={linkStyle}
            >
              {expired ? 'Send me a new link' : 'Set or reset your password'}
            </button>
          </form>
        )}

        {/* ── Send me a link ── */}
        {mode === 'sending' && (
          <form onSubmit={handleSendLink}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              style={inputStyle}
            />
            <button type="submit" disabled={busy} style={buttonStyle(busy)}>
              {busy ? 'Sending…' : 'Email me a link'}
            </button>
            <button
              type="button"
              onClick={() => {
                setError('')
                setMode('signin')
              }}
              style={linkStyle}
            >
              Back to signing in
            </button>
          </form>
        )}

        {/* ── Sent ── */}
        {mode === 'sent' && (
          <>
            <p style={{ ...metaStyle, margin: '0 0 1.25rem' }}>
              If {email} has an account, a link is on its way. It is good for one use and expires in
              24 hours — open it on this device if you can.
            </p>
            <button
              type="button"
              onClick={() => {
                setError('')
                setMode('signin')
              }}
              style={linkStyle}
            >
              Back to signing in
            </button>
          </>
        )}
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

const metaStyle: React.CSSProperties = {
  color: 'rgba(242,239,233,0.6)',
  fontSize: '0.78rem',
  lineHeight: 1.6,
}

function buttonStyle(busy: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '0.7rem',
    background: '#f2efe9',
    color: '#1a1715',
    border: 'none',
    fontFamily: 'var(--admin-font)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontSize: '0.8rem',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.6 : 1,
  }
}

const linkStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '1rem',
  padding: 0,
  background: 'none',
  border: 'none',
  color: 'rgba(242,239,233,0.6)',
  fontFamily: 'inherit',
  fontSize: '0.78rem',
  textAlign: 'center',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  cursor: 'pointer',
}
