'use server'

import { headers } from 'next/headers'
import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { photoUrl } from '@/lib/images'
import { sendEmail } from '@/lib/email'
import { sendGalleryEmailWith, type SendDb, type SendOutcome } from '@/lib/gallery-email-send'

/**
 * The Sharing tab's "Send email". Every check is in lib/gallery-email-send.ts;
 * this supplies the editor's own database session (row-level security still
 * applies on top of the explicit site filters there), the mail provider and
 * the address the photographer is working on — so the link in the email opens
 * on the same site.
 *
 * The same session makes the send-limit reservation
 * (`reserve_gallery_email_send`, EXECUTE to `authenticated` only). There is
 * deliberately no service-role client here and no fallback to one: if the
 * reservation cannot be made as the photographer, nothing is sent. The
 * reservation answers `reserved:<sha256 of the charged recipient>`, and the
 * send goes ahead only if that matches the address actually handed to the
 * provider (lib/gallery-email-send.ts).
 *
 * Answers with an outcome rather than throwing: a thrown server-action error
 * reaches the photographer redacted.
 */
export async function sendGalleryEmail(
  albumId: string,
  clientId: string,
  fields: { subject: string; message: string }
): Promise<SendOutcome> {
  const editor = await requireEditor()
  const supabase = await createClient()
  return sendGalleryEmailWith(
    {
      db: supabase as unknown as SendDb,
      send: sendEmail,
      imageUrl: photoUrl,
      origin: await requestOrigin(),
    },
    { tenantId: editor.tenantId, userId: editor.userId },
    albumId,
    clientId,
    fields ?? { subject: '', message: '' }
  )
}

async function requestOrigin(): Promise<string> {
  const host = (await headers()).get('host') ?? ''
  const scheme = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https'
  return `${scheme}://${host}`
}
