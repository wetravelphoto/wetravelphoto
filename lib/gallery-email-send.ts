import { createHash } from 'node:crypto'
import { PLATFORM } from '@/lib/platform'
import {
  RESERVE_TIMEOUT_MS,
  canonicalTenantId,
  clampEmailFields,
  galleryEmailConfigured,
  galleryFromAddress,
  galleryFromName,
  recipientBindingText,
  renderGalleryEmailHtml,
  renderGalleryEmailText,
  reservationDigest,
  sendableRecipient,
} from '@/lib/gallery-email'
import type { EmailResult } from '@/lib/email'

/**
 * Sending "Your gallery is ready" — the checks, in order, with the database
 * and the mail provider passed in (app/actions/gallery-email.ts supplies the
 * real ones after requireEditor(); .mk/client-gallery-v2.ts and
 * .mk/gallery-email-send-limit.ts supply fakes).
 *
 *   1. the album and the client are both this site's, and the album IS shared
 *      with that client — the link in the email must open it. What the email
 *      needs from these rows is copied out as plain values at once, so nothing
 *      read later can change the "before" it is compared with;
 *   2. sending is set up (RESEND_API_KEY) — without it the answer is
 *      `not_configured` and the composer offers Copy email / Copy link;
 *   3. the subject, the message and the recipient's address are usable, and
 *      the address is one whose database digest this side can reproduce
 *      (printable ASCII; `recipientBindingText`). `to` is fixed here: it is the
 *      one value hashed below and the one value handed to the provider;
 *   4. ONE reservation through `reserve_gallery_email_send`, on the
 *      photographer's own client (never the service role, which the function
 *      refuses anyway). Only a call that answered without error — PostgREST
 *      commits the function's transaction before it answers — with exactly
 *      `reserved:<64 lowercase hex>` permits a send. The old bare 'reserved',
 *      an error, a timeout, a limit, a missing function or any other answer
 *      sends nothing. A reservation is never given back, even when the
 *      provider then fails or a check below refuses;
 *   5. the digest returned must equal SHA-256(`<site id>:<lower(btrim(to))>`)
 *      for `to` itself. The function computes its digest once from the address
 *      it charged, so an address changed and changed back around the call
 *      (A → B → A) that charged B cannot send to A;
 *   6. the client, the share and the album are read AGAIN, and the stored
 *      address and the gallery link must be exactly what they were. Any change
 *      — or any failed read — sends nothing;
 *   7. one provider call, to `to`, no retry.
 */

type Row = Record<string, unknown>
type Result<T> = { data: T; error: unknown }
type RpcReply = { data: unknown; error: unknown; status?: number }
type RpcCall = PromiseLike<RpcReply> & { abortSignal?: (signal: AbortSignal) => unknown }
export type SendDb = {
  from: (table: string) => SendQuery
  /** The editor's own client's rpc — the reservation is made as the photographer. */
  rpc?: (fn: string, args: Record<string, unknown>) => RpcCall
}
type SendQuery = {
  select: (cols: string) => SendQuery
  eq: (col: string, v: unknown) => SendQuery
  maybeSingle: () => PromiseLike<Result<unknown>>
}

export type SendDeps = {
  db: SendDb
  send: (input: {
    to: string
    subject: string
    text: string
    html: string
    replyTo?: string
    fromName: string
    fromAddress: string
  }) => Promise<EmailResult>
  configured?: () => boolean
  /** Absolute URL of a stored image path. */
  imageUrl: (path: string) => string
  origin: string
  /** Overridable for tests only. */
  reserveTimeoutMs?: number
}

export type SendOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_configured' | 'invalid' | 'rate_limited' | 'failed'; error: string }

export type Reservation = { status: 'reserved'; digest: string } | { status: 'limited' } | { status: 'failed' }

const NOT_FOUND = { ok: false, reason: 'not_found', error: 'That client could not be found on this gallery.' } as const
const BAD_ADDRESS = { ok: false, reason: 'invalid', error: 'This client needs a valid email address before a gallery email can be sent.' } as const
const LIMITED = { ok: false, reason: 'rate_limited', error: 'That’s a lot of emails in a short time. Wait a little and try again.' } as const
const NOT_RESERVED = { ok: false, reason: 'failed', error: 'The email could not be sent right now. Nothing was sent — try again in a moment, or copy the link instead.' } as const
const DRIFTED = { ok: false, reason: 'failed', error: 'This client’s details changed while sending. Nothing was sent — check the address and try again.' } as const
const PROVIDER_FAILED = { ok: false, reason: 'failed', error: 'The email could not be sent. Try again, or copy the link instead.' } as const

/**
 * The digest the database returns for this site and this exact recipient:
 * SHA-256 of `<site id>:<lower(btrim(email))>` in UTF-8, lowercase hex. Null
 * when it cannot be reproduced with certainty (see `recipientBindingText`).
 */
export function recipientDigest(tenantId: string, recipient: string): string | null {
  const text = recipientBindingText(tenantId, recipient)
  return text === null ? null : createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * One call to `reserve_gallery_email_send`. 'reserved' (with the digest of the
 * recipient the database charged) only for a clean, committed answer of
 * exactly `reserved:<64 lowercase hex>`; 'limited' for the function's two
 * limit answers; 'failed' for everything else — the pre-correction bare
 * 'reserved', a timeout and a throw included.
 */
export async function reserveGallerySend(
  db: SendDb,
  args: { tenantId: string; albumId: string; clientId: string },
  timeoutMs = RESERVE_TIMEOUT_MS
): Promise<Reservation> {
  const failed = { status: 'failed' } as const
  if (typeof db.rpc !== 'function') return failed
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const call = db.rpc('reserve_gallery_email_send', { p_tenant: args.tenantId, p_album: args.albumId, p_client: args.clientId })
    const pending = call && typeof call.abortSignal === 'function' ? (call.abortSignal(abort.signal) as RpcCall) : call
    const timedOut = new Promise<'timeout'>((res) => {
      timer = setTimeout(() => (abort.abort(), res('timeout')), timeoutMs)
    })
    const reply = await Promise.race([Promise.resolve(pending), timedOut])
    if (reply === 'timeout' || !reply || typeof reply !== 'object') return failed
    if (reply.error != null) return failed
    if (typeof reply.status === 'number' && reply.status !== 200) return failed
    const digest = reservationDigest(reply.data)
    if (digest !== null) return { status: 'reserved', digest }
    if (reply.data === 'site_limited' || reply.data === 'recipient_limited') return { status: 'limited' }
    return failed
  } catch {
    return failed
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function sendGalleryEmailWith(
  deps: SendDeps,
  editor: { tenantId: string; userId: string },
  albumId: string,
  clientId: string,
  fields: { subject: unknown; message: unknown }
): Promise<SendOutcome> {
  const { db } = deps
  const { tenantId } = editor
  const one = async (q: SendQuery): Promise<Row | null> => {
    try {
      const { data, error } = await q.maybeSingle()
      return error || !data || typeof data !== 'object' ? null : (data as Row)
    } catch {
      return null
    }
  }
  // The binding as plain values, copied out of the rows the moment they are
  // read — a row object can be shared with whatever produced it.
  const readBinding = async () => {
    const album = await one(
      db.from('albums').select('id, title, cover_title_text, cover_photo_id, cover_custom_path').eq('tenant_id', tenantId).eq('id', albumId)
    )
    const client = await one(db.from('clients').select('id, name, email, access_token').eq('tenant_id', tenantId).eq('id', clientId))
    const share = album && client ? await one(db.from('album_clients').select('album_id').eq('album_id', albumId).eq('client_id', clientId)) : null
    if (!album || !client || !share) return null
    return {
      email: client.email as unknown,
      token: client.access_token as unknown,
      albumTitle: String(album.cover_title_text || album.title || ''),
      coverCustomPath: typeof album.cover_custom_path === 'string' ? album.cover_custom_path : null,
      coverPhotoId: typeof album.cover_photo_id === 'string' ? album.cover_photo_id : null,
    }
  }

  const before = await readBinding()
  if (!before) return NOT_FOUND

  if (!(deps.configured ?? galleryEmailConfigured)()) {
    return { ok: false, reason: 'not_configured', error: 'Sending email from Lens Grid isn’t switched on yet.' }
  }

  const { subject, message } = clampEmailFields(fields.subject, fields.message)
  if (!subject || !message) return { ok: false, reason: 'invalid', error: 'Add a subject and a message.' }

  // `to` is the recipient: hashed once here, compared with the reservation,
  // and passed to the provider unchanged. Nothing re-derives it later.
  const to = sendableRecipient(before.email)
  const token = typeof before.token === 'string' && before.token ? before.token : null
  if (!to || !token) return BAD_ADDRESS
  if (!canonicalTenantId(tenantId)) return NOT_RESERVED
  const expected = recipientDigest(tenantId, to)
  if (!expected) return BAD_ADDRESS

  // Everything the email needs that is not the recipient, read before the
  // reservation so the re-check below sits right against the provider call.
  const settings = await one(db.from('site_settings').select('site_title').eq('tenant_id', tenantId))
  const profile = await one(db.from('profiles').select('email').eq('tenant_id', tenantId).eq('id', editor.userId))
  const photographer = String(settings?.site_title ?? '').trim() || 'Your photographer'

  // The cover: a custom one by its path, else the chosen photograph's display file.
  let coverPath: string | null = before.coverCustomPath
  if (!coverPath && before.coverPhotoId) {
    const photo = await one(
      db.from('photos').select('storage_path').eq('tenant_id', tenantId).eq('album_id', albumId).eq('id', before.coverPhotoId)
    )
    coverPath = (photo?.storage_path as string | null) ?? null
  }

  // The one reservation for the one provider attempt below.
  const reservation = await reserveGallerySend(db, { tenantId, albumId, clientId }, deps.reserveTimeoutMs)
  if (reservation.status === 'limited') return LIMITED
  if (reservation.status !== 'reserved') return NOT_RESERVED

  // The recipient the database charged must be `to`. A mismatch spends the
  // reservation and sends nothing — no refund, no second try.
  if (reservation.digest !== expected) return DRIFTED

  // The share and the album must still stand, and the stored address and the
  // link must be exactly what they were.
  const after = await readBinding()
  if (!after) return DRIFTED
  if (after.email !== before.email || after.token !== before.token) return DRIFTED

  const content = {
    subject,
    message,
    albumTitle: before.albumTitle,
    photographerName: photographer,
    coverUrl: coverPath ? deps.imageUrl(coverPath) : null,
    galleryUrl: `${deps.origin}/gallery/${token}`,
  }

  let sent: EmailResult
  try {
    sent = await deps.send({
      to,
      subject,
      text: renderGalleryEmailText(content),
      html: renderGalleryEmailHtml(content),
      replyTo: typeof profile?.email === 'string' ? profile.email : undefined,
      fromName: galleryFromName(photographer, PLATFORM.name),
      fromAddress: galleryFromAddress(),
    })
  } catch {
    return PROVIDER_FAILED
  }
  // A failed provider call keeps its reservation: the limit counts attempts.
  return sent.ok ? { ok: true } : PROVIDER_FAILED
}
