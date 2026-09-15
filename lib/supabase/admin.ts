import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client. Bypasses every RLS policy, so it exists for
 * exactly one job: writing rows that an anonymous visitor must be able to
 * cause but must not be able to forge.
 *
 * Checkout is the case. An order carries a total; if the orders table allowed
 * anonymous inserts, anyone could POST straight to PostgREST and write their
 * own total. So orders have no public insert policy and the checkout action
 * writes them through this client instead.
 *
 * Never import this into a client component, and never read the key through a
 * NEXT_PUBLIC_ variable — that would ship it to the browser and hand over the
 * whole database.
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() was called in the browser. It is server-only.')
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is missing. Add it to .env.local (and to Vercel) ' +
        'from Supabase → Settings → API → secret key, then restart the dev server.'
    )
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * The same client, or null when the key is missing.
 *
 * `createAdminClient()` throws, which is right for checkout — an order that
 * cannot be written should fail loudly. It is wrong for a page: on 2026-09-15
 * the album page started reading through the service role, the key was not set
 * in Vercel, and every gallery on the site returned a 500 rather than simply
 * not showing the private ones.
 *
 * So a surface that can degrade asks for this instead, and decides for itself
 * what to do with nothing. A surface that cannot degrade keeps using
 * createAdminClient().
 */
export function createAdminClientOrNull() {
  try {
    return createAdminClient()
  } catch (error) {
    console.error(
      '[supabase] SUPABASE_SERVICE_ROLE_KEY is missing, so private galleries, ' +
        'share links and password-protected albums cannot be read. Add it in ' +
        'Vercel → Settings → Environment Variables (and .env.local for dev). ' +
        'Public pages are unaffected.',
      error instanceof Error ? error.message : error
    )
    return null
  }
}
