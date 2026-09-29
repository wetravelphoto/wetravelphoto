import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { cookies } from 'next/headers'
import { currentSite } from '@/lib/tenant'
import { createAdminClientOrNull } from '@/lib/supabase/admin'
import { liveLookups, recordVisit } from '@/lib/analytics/record'
import { cleanPathname, deviceFrom, isSessionId, referrerHost } from '@/lib/analytics/visit'

/**
 * ONE VIEW
 * ════════
 *
 * What the browser is allowed to say: the pathname it is on, the random id for
 * this tab, and the host it came from. That is the whole body. It does not name
 * a site, a gallery, a story or a page — those are worked out here from the
 * address the request arrived on (lib/analytics/record.ts), because an identity
 * the client chooses is an identity the client can choose wrongly.
 *
 * What is read from the request and NOT kept:
 *
 *   the IP address      hashed with the user-agent and today's date, and the
 *                       hash is 32 characters of the result. Neither input is
 *                       stored, and the date in it means the hash is different
 *                       tomorrow, so it counts people within a day and cannot
 *                       follow one across two.
 *   the user-agent      the same hash, and one of three words for `device`.
 *                       The string itself goes nowhere.
 *   the referrer        the browser has already reduced it to a host before
 *                       sending; this reduces it again and drops our own.
 *
 * Nothing is written to a cookie. Nothing reads one except the album password
 * gate, which is read to answer "did this visitor actually see the gallery".
 *
 * ── Always 200, and never a thrown error ────────────────────────────────────
 *
 * Analytics must not be the reason a page misbehaves, so every outcome is a
 * 200 with a word in it. `recorded` means a row; `ignored` means this address
 * is not a page of this site — a mistyped URL, the editor, a share link —
 * which is the ordinary case and not worth a log line; `refused` means the
 * database said no, which IS worth one and gets it in lib/analytics/record.ts.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, why: 'ignored' })
  }

  const path = cleanPathname((body as Record<string, unknown>).path)
  if (!path) return NextResponse.json({ ok: false, why: 'ignored' })

  // THE SESSION IS OPTIONAL AND THE PATH IS NOT.
  //
  // `sessionStorage` throws in a Safari private window and wherever site data
  // is blocked, so `session` arrives null from those browsers — and a missing
  // session must not cost the page view. It would mean not counting the people
  // most likely to have blocked storage, over a field that exists only for
  // within-visit funnels.
  //
  // An id that IS supplied is held to the exact shape: 32 lower-case hex
  // characters. Anything else becomes null rather than being passed on, because
  // whatever it is, it did not come from `randomSessionId()` — and a malformed
  // one would make the database refuse the whole view.
  const raw = (body as Record<string, unknown>).session
  const session = isSessionId(raw) ? raw : null

  // The site, from the address — never from the body.
  const site = await currentSite()
  if (!site) return NextResponse.json({ ok: false, why: 'ignored' })

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'
  const ua = request.headers.get('user-agent') ?? 'unknown'
  const day = new Date().toISOString().slice(0, 10)

  // Unchanged from before S4, deliberately: the same daily-rotating hash, so
  // the unique-visitor counts either side of this deployment mean the same
  // thing. One property of it is written up in db/schema-verified.md.
  const visitorHash = createHash('sha256').update(`${ip}|${ua}|${day}`).digest('hex').slice(0, 32)

  const store = await cookies()

  // `…OrNull` rather than the throwing one: a deployment without the key must
  // stop recording, not stop serving. The absence is already logged loudly by
  // lib/supabase/admin.ts, so it is not logged again per view.
  const db = createAdminClientOrNull()

  const outcome = await recordVisit(db, db && liveLookups(db, site.tenantId), {
    tenantId: site.tenantId,
    path,
    visitorHash,
    sessionHash: session,
    device: deviceFrom(ua, request.headers.get('sec-ch-ua-mobile')),
    referrerHost: referrerHost((body as Record<string, unknown>).ref, site.host),
    albumAccess: (albumId) => store.get(`album_access_${albumId}`)?.value === 'granted',
  })

  return NextResponse.json(
    outcome.ok ? { ok: true, why: 'recorded' } : { ok: false, why: outcome.why }
  )
}
