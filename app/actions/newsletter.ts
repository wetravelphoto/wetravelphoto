'use server'

import { createClient } from '@/lib/supabase/server'

export async function subscribe(formData: FormData) {
  const email = (formData.get('email') as string)?.trim().toLowerCase()

  if (!email || !email.includes('@')) {
    return { ok: false, message: 'That email doesn’t look right.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('newsletter_signups').insert({ email })

  // A duplicate just means they're already subscribed — not an error worth showing
  if (error && error.code !== '23505') {
    return { ok: false, message: 'Something went wrong. Try again?' }
  }

  return { ok: true, message: 'Thanks — you’re on the list.' }
}
