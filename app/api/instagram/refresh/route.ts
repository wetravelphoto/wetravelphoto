import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncInstagram, refreshInstagramToken } from '@/lib/instagram'

/**
 * Scheduled job: refreshes each site's Instagram token and re-pulls its feed.
 *
 * FAILS CLOSED. Vercel calls this with `Authorization: Bearer <CRON_SECRET>`.
 * It used to skip the check entirely when CRON_SECRET was unset, which made it
 * a public endpoint that anyone could hit to burn the Instagram rate limit.
 *
 * It runs with the service-role client because there is no signed-in user —
 * and it says which site on every query, looping over the sites that actually
 * have a token. With the ordinary client it could no longer read the token or
 * replace the feed once tables were scoped by site, so it had been failing
 * silently and the cached image links were left to expire.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data: sites, error } = await db
    .from('site_secrets')
    .select('tenant_id')
    .not('instagram_token', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = []
  for (const site of sites ?? []) {
    const target = { db, tenantId: site.tenant_id as string }
    const refreshed = await refreshInstagramToken(target)
    const synced = await syncInstagram(target)
    results.push({ tenant: target.tenantId, refreshed, synced })
  }

  return NextResponse.json({ sites: results.length, results })
}
