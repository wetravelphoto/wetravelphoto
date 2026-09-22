'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  chooseNewsletterList,
  connectNewsletter,
  disconnectNewsletter,
  newsletterLists,
  syncNewsletter,
} from '@/app/actions/newsletter'
import type { ListOption, ProviderInfo } from '@/lib/newsletter/providers'

/**
 * Settings → Newsletter.
 *
 * Sign-ups are always kept here (and can be downloaded as a spreadsheet).
 * Connecting a mailing service sends each new one there as it happens:
 *   1. pick the service;
 *   2. paste its API key, with instructions for where to find it;
 *   3. pick the list sign-ups join.
 * The key is checked on the spot by asking the service for its lists, and
 * never comes back to the browser once saved.
 */
export default function NewsletterPanel({
  providers,
  connection,
  counts,
}: {
  providers: ProviderInfo[]
  connection: { provider: string; listId: string | null; listName: string | null; doubleOptIn: boolean } | null
  counts: { total: number; waiting: number; failed: number }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const [choosing, setChoosing] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [lists, setLists] = useState<ListOption[] | null>(null)
  const [listId, setListId] = useState(connection?.listId ?? '')
  const [doubleOptIn, setDoubleOptIn] = useState(connection?.doubleOptIn ?? true)

  const current = connection ? providers.find((p) => p.id === connection.provider) : null
  const picking = choosing ? providers.find((p) => p.id === choosing) : null
  const listProvider = current ?? picking

  const run = (work: () => Promise<void>) => {
    setMessage(null)
    startTransition(async () => {
      try {
        await work()
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' })
      }
    })
  }

  const connect = () =>
    run(async () => {
      if (!choosing) return
      const r = await connectNewsletter(choosing, key)
      if (!r.ok) return setMessage({ ok: false, text: r.message })
      setKey('')
      setLists(r.lists)
      setListId(r.lists.length === 1 ? r.lists[0].id : '')
      setMessage({
        ok: true,
        text: r.lists.length
          ? 'Connected. Now choose where sign-ups go.'
          : 'Connected, but the account has no lists yet. Create one in the service, then press “Change list”.',
      })
      router.refresh()
    })

  const loadLists = () =>
    run(async () => {
      const r = await newsletterLists()
      if (!r.ok) return setMessage({ ok: false, text: r.message })
      setLists(r.lists)
    })

  const saveList = () =>
    run(async () => {
      const r = await chooseNewsletterList(listId, doubleOptIn)
      setMessage({ ok: r.ok, text: r.message })
      if (r.ok) {
        setLists(null)
        setChoosing(null)
        router.refresh()
      }
    })

  return (
    <div>
      <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
        {counts.total} sign-up{counts.total === 1 ? '' : 's'} so far, all kept here.{' '}
        {/* A file download, not a page: a plain link on purpose. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/newsletter/export" style={{ borderBottom: '0.5px solid currentColor' }}>
          Download as a spreadsheet (CSV)
        </a>
        . The signup block&apos;s text is edited in the editor (click the footer).
      </p>

      {connection && current ? (
        <div className="admin-subpanel" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <p style={{ margin: 0 }}>
            <strong>Connected to {current.name}</strong>
            {connection.listName ? (
              <>
                {' '}
                · new sign-ups join the {current.listWord} “{connection.listName}”
                {connection.doubleOptIn ? ', and are asked to confirm their email' : ''}.
              </>
            ) : (
              <span style={{ color: '#9a5b00' }}> · choose a {current.listWord} below so sign-ups can be sent.</span>
            )}
          </p>

          {(counts.waiting > 0 || counts.failed > 0) && connection.listId && (
            <p className="admin-meta" style={{ margin: 0 }}>
              {counts.waiting} sign-up{counts.waiting === 1 ? ' has' : 's have'} not been sent to {current.name} yet
              {counts.failed ? ` (${counts.failed} with an error)` : ''}.
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {counts.waiting > 0 && connection.listId && (
              <button
                type="button"
                className="admin-btn"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const r = await syncNewsletter()
                    setMessage({ ok: r.ok, text: r.message })
                    router.refresh()
                  })
                }
              >
                Send {counts.waiting} to {current.name}
              </button>
            )}
            <button type="button" className="admin-btn admin-btn-ghost" disabled={pending} onClick={loadLists}>
              Change {current.listWord}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-ghost"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Disconnect ${current.name}? Sign-ups will still be collected here.`)) return
                run(async () => {
                  const r = await disconnectNewsletter()
                  setMessage({ ok: r.ok, text: r.message })
                  setLists(null)
                  router.refresh()
                })
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            Send sign-ups to your mailing service automatically. Don&apos;t have one? Most of these have
            a free plan to start with.
          </p>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {providers.map((p) => (
              <button
                key={p.id}
                type="button"
                className={choosing === p.id ? 'admin-btn' : 'admin-btn admin-btn-ghost'}
                onClick={() => {
                  setChoosing(p.id)
                  setMessage(null)
                  setLists(null)
                }}
              >
                {p.name}
              </button>
            ))}
          </div>

          {picking && (
            <div className="admin-subpanel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
                <strong>Where to find your {picking.name} key:</strong> {picking.keyHelp}{' '}
                <a href={picking.keyUrl} target="_blank" rel="noopener noreferrer" style={{ borderBottom: '0.5px solid currentColor' }}>
                  Open {picking.name} ↗
                </a>
              </p>
              <label className="admin-field" style={{ margin: 0 }}>
                API key
                <input
                  type="password"
                  className="admin-input"
                  value={key}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Paste the key here"
                />
                <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
                  Stored privately for this site, and only used to add sign-ups to your list.
                </span>
              </label>
              <div>
                <button type="button" className="admin-btn" disabled={pending || key.trim().length < 8} onClick={connect}>
                  {pending ? 'Checking…' : `Connect ${picking.name}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {lists && listProvider && (
        <div className="admin-subpanel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.7rem' }}>
          <label className="admin-field" style={{ margin: 0 }}>
            Which {listProvider.listWord} should new sign-ups join?
            <select className="admin-select" value={listId} onChange={(e) => setListId(e.target.value)}>
              <option value="">Choose…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {listProvider.doubleOptIn && (
            <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
              <input type="checkbox" checked={doubleOptIn} onChange={(e) => setDoubleOptIn(e.target.checked)} />
              Ask new subscribers to confirm their email first (recommended)
            </label>
          )}
          <div>
            <button type="button" className="admin-btn" disabled={pending || !listId} onClick={saveList}>
              Save
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="admin-meta" style={{ margin: '0.7rem 0 0', color: message.ok ? undefined : '#b3261e' }}>
          {message.text}
        </p>
      )}
    </div>
  )
}
