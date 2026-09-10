import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

/**
 * Records an anonymous page view. We store a salted hash of IP + user agent
 * rather than anything identifying, which is enough to count unique visitors
 * per day without keeping personal data.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body?.albumId && !body?.postId) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'
  const ua = request.headers.get('user-agent') ?? 'unknown'
  const day = new Date().toISOString().slice(0, 10)

  const visitorHash = createHash('sha256').update(`${ip}|${ua}|${day}`).digest('hex').slice(0, 32)

  const supabase = await createClient()
  await supabase.from('page_views').insert({
    album_id: body.albumId ?? null,
    post_id: body.postId ?? null,
    visitor_hash: visitorHash,
  })

  return NextResponse.json({ ok: true })
}
