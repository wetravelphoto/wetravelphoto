'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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

  const supabase = await createClient()
  const { error } = await supabase.from('contact_messages').insert({ name, email, subject, message })

  if (error) {
    // The visitor gets a plain sentence; the real reason goes to the server
    // log, where it can be found. It used to be swallowed entirely, which made
    // a broken form indistinguishable from a quiet week.
    console.error('[contact] could not save a message:', error.message)
    return { ok: false, error: 'Something went wrong sending that. Try again, or email directly.' }
  }

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
