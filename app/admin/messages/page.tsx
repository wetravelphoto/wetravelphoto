import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { markRead, deleteMessage } from '@/app/actions/contact'
import ConfirmButton from '@/components/admin/ConfirmButton'

export const dynamic = 'force-dynamic'

export default async function MessagesPage() {
  const supabase = await createClient()
  const { data: messages } = await supabase
    .from('contact_messages')
    .select('*')
    .order('created_at', { ascending: false })

  const unread = messages?.filter((m) => !m.is_read).length ?? 0

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="admin-h1" style={{ marginBottom: '0.5rem' }}>
        Messages
      </h1>
      <p className="admin-meta" style={{ margin: '0 0 1.5rem' }}>
        {messages?.length ?? 0} total · {unread} unread · Where messages are emailed is set in{' '}
        <Link href="/admin/settings" style={{ borderBottom: '0.5px solid currentColor' }}>
          Settings
        </Link>
        .
      </p>

      {messages && messages.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="admin-panel"
              style={{ borderLeft: msg.is_read ? undefined : '2px solid var(--admin-accent)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <p style={{ margin: '0 0 0.2rem', fontSize: '0.95rem' }}>{msg.name}</p>
                  <a href={`mailto:${msg.email}`} className="admin-meta" style={{ borderBottom: '0.5px solid currentColor' }}>
                    {msg.email}
                  </a>
                </div>
                <span className="admin-meta">
                  {new Date(msg.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>

              {msg.subject && (
                <p style={{ margin: '0.85rem 0 0.35rem', fontSize: '0.9rem', fontWeight: 500 }}>
                  {msg.subject}
                </p>
              )}

              <p
                style={{
                  margin: msg.subject ? '0 0 0.85rem' : '0.85rem 0',
                  fontSize: '0.9rem',
                  lineHeight: 1.65,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.message}
              </p>

              {/* Whether this message was also emailed (lib/contact-notify.ts). */}
              {(msg.notified_at || msg.notify_error) && (
                <p className="admin-meta" style={{ margin: '0 0 0.7rem', color: msg.notify_error ? '#b3261e' : undefined }}>
                  {msg.notified_at ? 'Emailed to you.' : `Not emailed: ${msg.notify_error}`}
                </p>
              )}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <form action={markRead.bind(null, msg.id, !msg.is_read)}>
                  <button type="submit" className="admin-btn admin-btn-sm admin-btn-ghost">
                    Mark {msg.is_read ? 'unread' : 'read'}
                  </button>
                </form>
                <form action={deleteMessage.bind(null, msg.id)}>
                  <ConfirmButton label="Delete" confirmLabel="Confirm" />
                </form>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-empty">No messages yet.</div>
      )}
    </div>
  )
}
