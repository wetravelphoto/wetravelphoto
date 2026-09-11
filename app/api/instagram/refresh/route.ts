import { syncInstagram, refreshInstagramToken } from '@/lib/instagram'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Scheduled job: refreshes the access token and re-pulls the feed.
 * Vercel calls this with a bearer token so it can't be triggered by anyone.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')

  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const refreshed = await refreshInstagramToken()
  const synced = await syncInstagram()

  return NextResponse.json({ refreshed, synced })
}
