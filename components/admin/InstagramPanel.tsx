'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { syncNow, refreshTokenNow, disconnectInstagram } from '@/app/actions/instagram'

export default function InstagramPanel({
  connected,
  expiresAt,
  syncedAt,
  postCount,
}: {
  connected: boolean
  expiresAt: string | null
  syncedAt: string | null
  postCount: number
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const router = useRouter()

  async function run(label: string, action: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(label)
    setMessage(null)
    const result = await action()
    setBusy(null)
    setMessage(result.message)
    router.refresh()
  }

  if (!connected) {
    return (
      <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
        Not connected. Paste a long-lived access token above to start pulling posts.
      </p>
    )
  }

  const daysLeft = expiresAt
    ? Math.round((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.85rem' }}>
        <p className="admin-meta" style={{ margin: 0 }}>
          {postCount} post{postCount === 1 ? '' : 's'} cached
          {syncedAt && ` · last synced ${new Date(syncedAt).toLocaleString()}`}
        </p>
        {daysLeft !== null && (
          <p
            className="admin-meta"
            style={{ margin: 0, color: daysLeft < 10 ? 'var(--admin-danger)' : undefined }}
          >
            Token valid for about {daysLeft} more day{daysLeft === 1 ? '' : 's'}
            {daysLeft < 10 && ' — refresh it soon'}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => run('sync', syncNow)}
          className="admin-btn admin-btn-sm admin-btn-ghost"
        >
          {busy === 'sync' ? 'Syncing…' : 'Sync now'}
        </button>

        <button
          type="button"
          disabled={!!busy}
          onClick={() => run('token', refreshTokenNow)}
          className="admin-btn admin-btn-sm admin-btn-ghost"
        >
          {busy === 'token' ? 'Refreshing…' : 'Refresh token'}
        </button>

        <button
          type="button"
          disabled={!!busy}
          onClick={async () => {
            if (!confirming) {
              setConfirming(true)
              return
            }
            setBusy('disconnect')
            await disconnectInstagram()
            setBusy(null)
            setConfirming(false)
            router.refresh()
          }}
          onBlur={() => setConfirming(false)}
          className="admin-btn admin-btn-sm admin-btn-danger"
        >
          {confirming ? 'Confirm' : 'Disconnect'}
        </button>
      </div>

      {message && (
        <p className="admin-meta" style={{ marginTop: '0.6rem', color: 'var(--admin-accent)' }}>
          {message}
        </p>
      )}
    </div>
  )
}
