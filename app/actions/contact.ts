'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { randomUUID } from 'crypto'
import { verifyTurnstile } from '@/lib/turnstile'
import { notifyMessage } from '@/lib/contact-notify'

export async function sendMessage(formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim()
  const subject = (formData.get('subject') as string)?.trim() || null
  const message = (formData.get('message') as string)?.trim()
  // Bots fill hidden fields; humans leave them empty
  const honeypot = formData.get('website') as string

  if (honeypot) return { ok: true }
  if (!name || !email || !message) {
    return { ok: false, error: 'Please fill in every field.' }
  }
  // A public form: every field is bounded, so nobody can post a novel into
  // the messages table or a name that breaks the admin list.
  if (name.length > 120 || email.length > 200 || (subject?.length ?? 0) > 200) {
    return { ok: false, error: 'One of those fields is too long.' }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'That email doesn’t look right.' }
  }
  if (message.length > 4000) {
    return { ok: false, error: 'That message is a bit too long.' }
  }

  // The spam check (Cloudflare Turnstile), when it is configured.
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const human = await verifyTurnstile((formData.get('cf-turnstile-response') as string) || null, ip)
  if (!human) {
    return { ok: false, error: 'Please wait a moment for the spam check, then send again.' }
  }

  // The id is made here, because a visitor may add a message but not read one
  // back — and the email step below needs to say which message it reported on.
  const id = randomUUID()
  const supabase = await createClient()
  const { error } = await supabase.from('contact_messages').insert({ id, name, email, subject, message })

  if (error) {
    // The visitor gets a plain sentence; the real reason goes to the server
    // log, where it can be found. It used to be swallowed entirely, which made
    // a broken form indistinguishable from a quiet week.
    console.error('[contact] could not save a message:', error.message)
    return { ok: false, error: 'Something went wrong sending that. Try again, or email directly.' }
  }

  // Tell the photographer by email. Stored first, so a failed email loses nothing.
  await notifyMessage({ id, name, email, subject, body: message })

  return { ok: true }
}

export async function markRead(id: string, isRead: boolean) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()
  await supabase.from('contact_messages').update({ is_read: isRead }).eq('id', id)
  revalidatePath('/admin/messages')
}

export async function deleteMessage(id: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()
  await supabase.from('contact_messages').delete().eq('id', id)
  revalidatePath('/admin/messages')
}
