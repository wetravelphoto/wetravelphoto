'use client'

import { useMemo, useState, useTransition } from 'react'
import { sendGalleryEmail } from '@/app/actions/gallery-email'
import {
  MESSAGE_MAX,
  SUBJECT_MAX,
  defaultGalleryEmail,
  renderGalleryEmailHtml,
  renderGalleryEmailText,
} from '@/lib/gallery-email'

/**
 * "Send to client by email": a composer pre-filled from the template, editable,
 * with a live preview drawn by renderGalleryEmailHtml — the function the
 * server sends — so the preview is the email.
 *
 * Without RESEND_API_KEY on the server the composer still works: Send gives
 * way to Copy email and Copy link, with one sentence saying why.
 */
export default function EmailComposer({
  albumId,
  albumTitle,
  client,
  photographerName,
  coverUrl,
  galleryUrl,
  configured,
  onClose,
}: {
  albumId: string
  albumTitle: string
  client: { id: string; name: string; email: string }
  photographerName: string
  coverUrl: string | null
  galleryUrl: string
  configured: boolean
  onClose: () => void
}) {
  const initial = useMemo(
    () => defaultGalleryEmail({ albumTitle, clientName: client.name, photographerName }),
    [albumTitle, client.name, photographerName]
  )
  const [subject, setSubject] = useState(initial.subject)
  const [message, setMessage] = useState(initial.message)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState<'email' | 'link' | null>(null)
  const [pending, startTransition] = useTransition()

  const content = { subject, message, albumTitle, photographerName, coverUrl, galleryUrl }
  const html = renderGalleryEmailHtml(content)

  async function copy(which: 'email' | 'link') {
    const text = which === 'link' ? galleryUrl : `Subject: ${subject}\n\n${renderGalleryEmailText(content)}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 2200)
    } catch {
      window.prompt('Copy this', text)
    }
  }

  function send() {
    setStatus(null)
    startTransition(async () => {
      const r = await sendGalleryEmail(albumId, client.id, { subject, message })
      setStatus(r.ok ? { ok: true, text: `Sent to ${client.email}.` } : { ok: false, text: r.error })
    })
  }

  return (
    <div className="cover-modal" onClick={onClose}>
      <div className="composer" role="dialog" aria-label={`Email ${client.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="composer-form">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
            <h2 className="admin-h2" style={{ margin: 0 }}>Email {client.name}</h2>
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
          <p className="admin-meta" style={{ margin: '0.35rem 0 1rem' }}>To {client.email}</p>

          <label className="admin-field">
            Subject
            <input
              type="text"
              value={subject}
              maxLength={SUBJECT_MAX}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              className="admin-input"
              autoComplete="off"
            />
          </label>

          <label className="admin-field">
            Message
            <textarea
              value={message}
              maxLength={MESSAGE_MAX}
              onChange={(e) => setMessage(e.target.value)}
              rows={9}
              className="admin-input"
              style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
            />
          </label>

          {configured ? (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="admin-btn" onClick={send} disabled={pending || !subject.trim() || !message.trim()}>
                {pending ? 'Sending…' : 'Send'}
              </button>
              <button type="button" className="admin-btn admin-btn-ghost" onClick={() => copy('link')}>
                {copied === 'link' ? 'Link copied' : 'Copy link'}
              </button>
            </div>
          ) : (
            <>
              <p className="admin-meta" style={{ margin: '0 0 0.75rem', lineHeight: 1.6 }}>
                Sending from Lens Grid isn’t switched on yet, so copy the email and send it from your own address.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="admin-btn" onClick={() => copy('email')}>
                  {copied === 'email' ? 'Email copied' : 'Copy email'}
                </button>
                <button type="button" className="admin-btn admin-btn-ghost" onClick={() => copy('link')}>
                  {copied === 'link' ? 'Link copied' : 'Copy link'}
                </button>
              </div>
            </>
          )}

          {status && (
            <p className="admin-meta" style={{ margin: '0.75rem 0 0', color: status.ok ? undefined : '#b3261e' }}>
              {status.text}
            </p>
          )}
        </div>

        <div className="composer-preview">
          <p className="admin-meta" style={{ margin: '0 0 0.5rem' }}>Preview</p>
          {/* sandbox with no permissions: the preview can show the email and do nothing else. */}
          <iframe title="Email preview" srcDoc={html} sandbox="" className="composer-frame" />
        </div>
      </div>
    </div>
  )
}
