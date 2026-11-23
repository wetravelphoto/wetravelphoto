'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addClientToAlbum, removeClientFromAlbum } from '@/app/actions/clients'
import EmailComposer from '@/components/admin/album/EmailComposer'
import type { SharedClient } from '@/lib/clients/share'

export type Privacy = 'public' | 'unlisted' | 'password' | 'client_only'

const PRIVACY: { value: Privacy; label: string; hint: string }[] = [
  { value: 'public', label: 'Public', hint: 'On your galleries page, for everyone.' },
  { value: 'unlisted', label: 'Unlisted', hint: 'Only people with the link.' },
  { value: 'password', label: 'Password', hint: 'The link asks for a password first.' },
  { value: 'client_only', label: 'Client only', hint: 'Each client opens it with their own private link.' },
]

/**
 * THE SHARING TAB — the one place an album's privacy, links and clients live
 * (they used to be panels on the settings page around the form).
 *
 * Privacy and downloads are fields of the settings form and save with it.
 * Adding, removing and emailing a client act at once, through their own
 * server actions (each requireEditor() and site-scoped) — buttons, never a
 * nested form.
 */
export default function SharingPanel({
  albumId,
  albumTitle,
  privacy,
  onPrivacy,
  allowDownloads,
  onAllowDownloads,
  albumUrl,
  origin,
  clients,
  contacts,
  emailConfigured,
  photographerName,
  coverUrl,
}: {
  albumId: string
  albumTitle: string
  privacy: Privacy
  onPrivacy: (p: Privacy) => void
  allowDownloads: boolean
  onAllowDownloads: (v: boolean) => void
  albumUrl: string
  origin: string
  clients: SharedClient[]
  contacts: { id: string; name: string; email: string }[]
  emailConfigured: boolean
  photographerName: string
  coverUrl: string | null
}) {
  return (
    <>
      <div className="admin-panel" style={{ marginBottom: '1rem' }}>
        <h2 className="admin-h2">Who can see this gallery</h2>
        <div className="privacy-choices" role="radiogroup" aria-label="Privacy">
          {PRIVACY.map((p) => (
            <label key={p.value} className="privacy-choice" data-active={privacy === p.value}>
              <input
                type="radio"
                name="privacy_type"
                value={p.value}
                checked={privacy === p.value}
                onChange={() => onPrivacy(p.value)}
              />
              <span className="privacy-choice-label">{p.label}</span>
              <span className="admin-meta">{p.hint}</span>
            </label>
          ))}
        </div>

        {privacy === 'password' ? (
          <label className="admin-field" style={{ marginTop: '1rem' }}>
            Password
            <input
              type="password"
              name="password"
              placeholder="Leave empty to keep the current password"
              className="admin-input"
              autoComplete="new-password"
            />
          </label>
        ) : (
          <input type="hidden" name="password" value="" />
        )}

        {/*
          One switch, two doors: a public album's zip, and a client's download
          buttons — and both download routes ask it too. Off by default: a
          photographer who has not thought about it has not agreed to hand over
          full-size files.
        */}
        <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '1rem 0 0.35rem' }}>
          <input type="checkbox" name="allow_downloads" checked={allowDownloads} onChange={(e) => onAllowDownloads(e.target.checked)} />
          Let people download the photographs
        </label>
        <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
          {allowDownloads
            ? 'Clients get Download all and Download favorites, and a public album offers a zip of the whole gallery. Full-size originals.'
            : 'Downloads are off. Nobody — client or visitor — can save the files from the gallery page.'}
        </p>
        <p className="admin-meta" style={{ margin: '0.75rem 0 0' }}>Privacy and downloads change when you save.</p>
      </div>

      {privacy === 'client_only' ? (
        <ClientsPanel
          albumId={albumId}
          albumTitle={albumTitle}
          origin={origin}
          clients={clients}
          contacts={contacts}
          emailConfigured={emailConfigured}
          photographerName={photographerName}
          coverUrl={coverUrl}
        />
      ) : (
        <div className="admin-panel">
          <h2 className="admin-h2">Link</h2>
          <CopyRow url={albumUrl} />
          <p className="admin-meta" style={{ margin: '0.6rem 0 0', lineHeight: 1.6 }}>
            {privacy === 'public'
              ? 'Also listed on your galleries page.'
              : privacy === 'unlisted'
                ? 'Hidden from your listings. Anyone with this link can open it.'
                : 'Hidden from your listings. This link asks for the password first.'}
          </p>
        </div>
      )}
    </>
  )
}

function CopyRow({ url, label = 'Copy link' }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <input readOnly value={url} className="admin-input" style={{ marginTop: 0, flex: 1, minWidth: 0 }} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="admin-btn admin-btn-ghost admin-btn-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => window.prompt('Copy this link', url))
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? 'Copied' : label}
      </button>
    </div>
  )
}

function ClientsPanel({
  albumId,
  albumTitle,
  origin,
  clients,
  contacts,
  emailConfigured,
  photographerName,
  coverUrl,
}: {
  albumId: string
  albumTitle: string
  origin: string
  clients: SharedClient[]
  contacts: { id: string; name: string; email: string }[]
  emailConfigured: boolean
  photographerName: string
  coverUrl: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [choice, setChoice] = useState<string>(contacts[0]?.id ?? 'new')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [composing, setComposing] = useState<SharedClient | null>(null)

  const linkFor = (c: SharedClient) => `${origin}/gallery/${c.token}`
  const creating = choice === 'new' || contacts.length === 0

  function add() {
    setError(null)
    startTransition(async () => {
      const r = await addClientToAlbum(albumId, creating ? { name, email } : { clientId: choice })
      if (!r.ok) {
        setError(r.error)
        return
      }
      setName('')
      setEmail('')
      router.refresh()
    })
  }

  function remove(c: SharedClient) {
    setError(null)
    startTransition(async () => {
      const r = await removeClientFromAlbum(albumId, c.id)
      if (!r.ok) setError(r.error ?? 'It could not be removed.')
      else router.refresh()
    })
  }

  const enterAdds = (e: React.KeyboardEvent) => {
    // Enter inside these fields must add the client, never submit the settings form around them.
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    }
  }

  return (
    <div className="admin-panel">
      <h2 className="admin-h2">Shared with clients</h2>

      {clients.length === 0 ? (
        <p className="admin-meta" style={{ margin: '0 0 1rem', color: '#9a5b00' }}>
          Not shared with anyone yet, so nobody can open it.
        </p>
      ) : (
        <ul className="share-clients">
          {clients.map((c) => (
            <li key={c.id}>
              <span style={{ minWidth: 0 }}>
                {c.name} <span className="admin-meta">{c.email}</span>
              </span>
              <span className="share-client-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn-ghost admin-btn-sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(linkFor(c)).catch(() => window.prompt('Copy this link', linkFor(c)))
                    setCopiedId(c.id)
                    setTimeout(() => setCopiedId(null), 2000)
                  }}
                >
                  {copiedId === c.id ? 'Copied' : 'Copy link'}
                </button>
                <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setComposing(c)}>
                  Send email
                </button>
                <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm admin-btn-danger" disabled={pending} onClick={() => remove(c)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="share-add">
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 500 }}>Add client</p>
        {contacts.length > 0 && (
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className="admin-select" style={{ marginTop: 0 }} aria-label="Contact">
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.email})
              </option>
            ))}
            <option value="new">New client…</option>
          </select>
        )}
        {creating && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={enterAdds}
              placeholder="Name"
              aria-label="Client name"
              className="admin-input"
              style={{ marginTop: 0, flex: '1 1 160px' }}
              autoComplete="off"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={enterAdds}
              placeholder="Email"
              aria-label="Client email"
              className="admin-input"
              style={{ marginTop: 0, flex: '1 1 200px' }}
              autoComplete="off"
            />
          </div>
        )}
        <button type="button" className="admin-btn admin-btn-sm" style={{ marginTop: '0.6rem' }} disabled={pending} onClick={add}>
          {pending ? 'Sharing…' : 'Add client'}
        </button>
        {error && <p className="admin-meta" style={{ margin: '0.5rem 0 0', color: '#b3261e' }}>{error}</p>}
        <p className="admin-meta" style={{ margin: '0.75rem 0 0', lineHeight: 1.6 }}>
          Each client has one private link that opens every gallery shared with them.
        </p>
      </div>

      {composing && (
        <EmailComposer
          albumId={albumId}
          albumTitle={albumTitle}
          client={composing}
          photographerName={photographerName}
          coverUrl={coverUrl}
          galleryUrl={linkFor(composing)}
          configured={emailConfigured}
          onClose={() => setComposing(null)}
        />
      )}
    </div>
  )
}
