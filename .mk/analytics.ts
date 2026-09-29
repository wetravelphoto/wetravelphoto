import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  DEVICES,
  cleanPathname,
  deviceFrom,
  isSessionId,
  isTrackablePath,
  referrerHost,
  UNTRACKED_PREFIXES,
  visitBody,
} from '../lib/analytics/visit'
import {
  SESSION_KEY,
  randomSessionId,
  sessionIdIn,
  type StorageLike,
} from '../lib/analytics/session'
import { TRACKED_PAGE_KEYS, builtinKeyAt, builtinPath } from '../lib/analytics/pages'
import { identify, recordVisit, type SiteLookups } from '../lib/analytics/record'
import { PAGES } from '../lib/sections/pages'

/**
 * ANALYTICS, EVERYWHERE EXCEPT INSIDE THE DATABASE
 * ═══════════════════════════════════════════════
 *
 * `db/verify-analytics.sql` proves the boundary: who may write, what is
 * refused, which site a row belongs to. This proves the part above it — that
 * the right pathname resolves to the right page, that the wrong ones resolve to
 * nothing, that a query string is gone before anything sees it, that a session
 * id lives in one place and nowhere else.
 *
 * It needs a Postgres carrying `db/test-fixture.sql`, which since the S4
 * deployment was reconciled into it already contains `page_views` in its
 * deployed shape and `record_page_view`:
 *
 *   PGHOST=/tmp PGPORT=5433 PGDATABASE=wtp PGUSER=postgres npx tsx .mk/analytics.ts
 *
 * With no database reachable the pure half still runs and the round-trip half
 * SKIPS LOUDLY. A suite that goes green by not running is worse than no suite.
 *
 * ── What the adapter is, and what it is not ─────────────────────────────────
 *
 * Two seams, and both are narrow on purpose:
 *
 *   the RPC       `recordVisit` uses one method on a Supabase client, `.rpc()`.
 *                 The adapter is that one method over a real connection, and it
 *                 exists to reproduce PostgREST's ENVELOPE (`{data, error}`),
 *                 not the behaviour under test. What is being tested happens
 *                 inside the real `record_page_view`.
 *
 *   the lookups   `identify()` takes the three questions it asks about a site.
 *                 The ones below run the SAME SQL as `liveLookups()` against
 *                 the real fixture. Nothing invents an answer: a gallery
 *                 belonging to another site is absent because the query says
 *                 `where tenant_id = …`, which is the thing worth proving.
 *
 * The RPC runs as **service_role**, which is the role the route actually has.
 * Not a detail: as the table's owner every privilege is held and RLS is
 * bypassed, so a harness running as the owner cannot see a grant problem — and
 * a grant problem is exactly what this phase found (`deleteSite` needed SELECT
 * as well as DELETE to filter its delete).
 */

const ROOT = '/home/claude/build'
const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const TENANT_B = 'aaaaaaaa-0000-0000-0000-000000000002'
const ALBUM_A = 'bbbbbbbb-0000-0000-0000-000000000001' // public
const LOCKED_A = 'bbbbbbbb-0000-0000-0000-000000000002' // client_only
const POST_A = 'dddddddd-0000-0000-0000-000000000001'

let pass = 0
const fail: string[] = []
const ok = (n: string, good: boolean, d = '') =>
  good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`)
const is = (n: string, got: unknown, want: unknown) =>
  ok(
    n,
    JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got) === JSON.stringify(want)
      ? ''
      : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`
  )

// ════════════════════════════════════════════════════════════════════════════
// 1. A PATHNAME, AND NOTHING ELSE THAT WAS IN THE ADDRESS BAR
// ════════════════════════════════════════════════════════════════════════════
//
// This is the function that makes "no query strings" true rather than intended.
// A photographer's link with `?email=` on the end, an unsubscribe token, a UTM
// tag somebody pasted — all of it is cut here, in the tab, before the request
// is made, and cut again in the database.

is('the homepage stays the homepage', cleanPathname('/'), '/')
is('a query string is cut', cleanPathname('/?email=someone@example.com'), '/')
is('so is a fragment', cleanPathname('/about#team'), '/about')
is('and both together', cleanPathname('/journal/x?utm_source=ig#top'), '/journal/x')
is('a trailing slash is one page, not two', cleanPathname('/about/'), '/about')
is('the root keeps its slash', cleanPathname('//'), null)
is('an absolute URL is not a path', cleanPathname('https://one.example/about'), null)
is('nor is a protocol-relative one', cleanPathname('//evil.example/about'), null)
is('a path with a space is refused', cleanPathname('/a b'), null)
is('a backslash is refused', cleanPathname('/a\\b'), null)
is('a path over 255 characters is refused', cleanPathname('/' + 'a'.repeat(255)), null)
is('a non-string is refused', cleanPathname(undefined), null)
is('a relative path is refused', cleanPathname('about'), null)

// The one that would have been easy to get wrong: reducing must be idempotent,
// because it happens twice — once in the tab and once on the server.
for (const raw of ['/', '/about/', '/journal/x?y=1', '/trips/a#b']) {
  const once = cleanPathname(raw)
  is(`reducing ${raw} twice changes nothing`, cleanPathname(once), once)
}

// ── Which addresses are a visitor looking at a website ──────────────────────

for (const path of ['/', '/about', '/contact', '/journal', '/trips', '/shop', '/weddings',
                    '/trips/iceland', '/journal/first-light']) {
  ok(`${path} is trackable`, isTrackablePath(path), path)
}

for (const path of ['/admin', '/admin/settings', '/edit/home', '/preview/about',
                    '/api/view', '/_next/static/x', '/.well-known/y']) {
  ok(`${path} is not`, !isTrackablePath(path), path)
}

// Every prefix on the list does what the list says. A prefix that had a typo in
// it would sit there looking like protection and provide none — the exact shape
// of "a declaration with nothing behind it" this project keeps paying for.
for (const prefix of UNTRACKED_PREFIXES) {
  ok(`${prefix} itself is untracked`, !isTrackablePath(prefix), prefix)
  ok(`${prefix}anything is untracked`, !isTrackablePath(`${prefix}x/y`), prefix)
}

// A SHARE LINK IS A CREDENTIAL. `/gallery/<token>` and `/review/<token>` carry
// one in the second segment — anybody holding it can open the gallery — so a
// path containing one must never be written into a table the dashboard reads or
// an export includes. Same reason Sentry scrubs them.
ok('a share link never becomes a path', !isTrackablePath('/gallery/abc123token'))
ok('nor does a review link', !isTrackablePath('/review/abc123token'))

// And a single print's page, which is excluded for a different reason: its
// identity is a photograph id and there is no column to validate one against.
ok('a print page is not tracked in S4', !isTrackablePath('/shop/some-photo-id'))
ok('but the shop itself is', isTrackablePath('/shop'))

// ════════════════════════════════════════════════════════════════════════════
// 2. A HOST, NEVER A REFERRER
// ════════════════════════════════════════════════════════════════════════════

is('a full referrer keeps only its host', referrerHost('https://google.com/search?q=x', 'one.example'), 'google.com')
is('a bare host is kept', referrerHost('instagram.com', 'one.example'), 'instagram.com')
is('a host with a path is reduced', referrerHost('google.com/search', 'one.example'), 'google.com')
is('a search query cannot survive', referrerHost('https://google.com/search?q=wildlife+prints', 'one.example'), 'google.com')
is('case is normalised', referrerHost('Instagram.COM', 'one.example'), 'instagram.com')
is('a trailing dot goes', referrerHost('instagram.com.', 'one.example'), 'instagram.com')
is('our own address is not a referrer', referrerHost('https://one.example/about', 'one.example'), null)
is('nor our own address in another case', referrerHost('ONE.EXAMPLE', 'one.example'), null)
is('a single label is refused', referrerHost('localhost', 'one.example'), null)
is('an empty referrer is null', referrerHost('', 'one.example'), null)
is('a non-string is null', referrerHost(42, 'one.example'), null)
is('a port is not kept', referrerHost('https://google.com:8443/x', 'one.example'), 'google.com')
is('userinfo cannot smuggle a host', referrerHost('https://google.com@evil.example/', 'one.example'), 'evil.example')

// No path, no search and no scheme can be in the result, whatever went in.
for (const raw of [
  'https://google.com/search?q=someone%40example.com',
  'http://t.co/abc',
  'https://mail.google.com/mail/u/0/#inbox/FMfcgz',
]) {
  const host = referrerHost(raw, 'one.example')
  ok(
    `nothing but a host survives ${raw.slice(0, 28)}…`,
    host !== null && !/[/?#:@]/.test(host),
    String(host)
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 3. THREE WORDS, AND THE STRING THEY CAME FROM IS GONE
// ════════════════════════════════════════════════════════════════════════════
//
// The order of the two tests inside `deviceFrom` is the whole of it: every
// tablet also matches a phone pattern (an iPad says "Mobile", an Android tablet
// says "Android"), so testing for phones first makes tablets stop existing and
// breaks nothing visibly.

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  galaxyTab: 'Mozilla/5.0 (Linux; Android 12; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110 Safari/537.36',
  kindle: 'Mozilla/5.0 (Linux; U; Android 5.1.1; en-us; KFAUWI Build/LVY48F) AppleWebKit/537.36 (KHTML, like Gecko) Silk/87.3.9 like Chrome/87 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
}

is('an iPhone is a phone', deviceFrom(UA.iphone), 'phone')
is('an Android phone is a phone', deviceFrom(UA.androidPhone), 'phone')
is('an iPad is a TABLET, not a phone', deviceFrom(UA.ipad), 'tablet')
is('an Android tablet is a tablet', deviceFrom(UA.androidTablet), 'tablet')
is('a Galaxy Tab is a tablet', deviceFrom(UA.galaxyTab), 'tablet')
is('a Kindle is a tablet', deviceFrom(UA.kindle), 'tablet')
is('a Mac is a desktop', deviceFrom(UA.mac), 'desktop')
is('Windows is a desktop', deviceFrom(UA.windows), 'desktop')
is('desktop Firefox is a desktop', deviceFrom(UA.firefox), 'desktop')
is('a crawler is a desktop', deviceFrom(UA.bot), 'desktop')
is('no user-agent at all is a desktop', deviceFrom(null), 'desktop')
is('the client hint alone makes a phone', deviceFrom('', '?1'), 'phone')
is('and ?0 leaves it a desktop', deviceFrom(UA.mac, '?0'), 'desktop')
is('the hint cannot turn an iPad into a phone', deviceFrom(UA.ipad, '?1'), 'tablet')

// Whatever it is handed, the answer is one of three words — which is what makes
// it impossible for the string to end up in the column.
for (const [name, ua] of Object.entries(UA)) {
  ok(`${name} buckets to one of three words`, DEVICES.includes(deviceFrom(ua)), deviceFrom(ua))
}
is('an empty string is still a bucket', DEVICES.includes(deviceFrom('')), true)

// ════════════════════════════════════════════════════════════════════════════
// 4. ONE VISIT, ONE ID, ONE TAB
// ════════════════════════════════════════════════════════════════════════════
//
// `sessionStorage` is per-tab and survives navigation within that tab; the
// browser clears it when the tab goes. Those are the platform's guarantees and
// are not what is checked here. What IS checked is that the code uses exactly
// that store and behaves correctly given it: the same store handed to two calls
// is what navigating within a tab looks like, and a fresh store is what a new
// tab looks like.

function store(initial?: Record<string, string>): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

{
  const tab = store()
  const first = sessionIdIn(tab)
  const second = sessionIdIn(tab)
  const third = sessionIdIn(tab)

  ok('a fresh tab mints an id', isSessionId(first), String(first))
  is('the id survives navigating within the tab', second, first)
  is('and a third page too', third, first)
  is('and it is stored under one key', Object.keys(tab.data), [SESSION_KEY])

  const newTab = store()
  const other = sessionIdIn(newTab)
  ok('a new tab gets a different id', isSessionId(other) && other !== first, `${first} / ${other}`)
}

{
  // A stored value that did not come from here is replaced, not trusted: this
  // is the column's shape guarantee, and something else's identifier must not
  // be able to ride in on it.
  const tampered = store({ [SESSION_KEY]: '11111111-1111-1111-1111-111111111111' })
  const id = sessionIdIn(tampered)
  ok('a stored value of the wrong shape is replaced', isSessionId(id), String(id))
  ok('and the bad one is gone', tampered.data[SESSION_KEY] === id)
}

{
  // ── A MISSING SESSION IS NOT A MISSING VIEW ──────────────────────────────
  //
  // Safari in a private window, and any browser with site data blocked. Two
  // things have to be true at once and the second is the correction of
  // 2026-09-29: no id comes back, AND the page view still goes.
  //
  // The first version returned early when there was no id, so a browser that
  // respects its user was an uncounted visitor — and the people most likely to
  // have blocked storage are exactly the ones silently dropped.
  const hostile: StorageLike = {
    getItem() {
      throw new Error('The operation is insecure.')
    },
    setItem() {
      throw new Error('The operation is insecure.')
    },
  }
  is('a store that throws yields no id rather than an error', sessionIdIn(hostile), null)

  // A store that simply forgets — an over-eager privacy extension — is the
  // same case, arrived at differently.
  const amnesiac: StorageLike = { getItem: () => null, setItem: () => {} }
  ok('a store that forgets everything is handled too',
     isSessionId(sessionIdIn(amnesiac)), String(sessionIdIn(amnesiac)))

  // And the body that gets sent in each case. `visitBody` is what the tracker
  // actually calls, so this IS the request, not a model of it.
  is('with a session, it is sent',
     visitBody('/about', 'a'.repeat(32), 'instagram.com'),
     { path: '/about', session: 'a'.repeat(32), ref: 'instagram.com' })
  is('with NO session, the view is still sent — with session null',
     visitBody('/about', null, null),
     { path: '/about', session: null, ref: null })
  is('and the path is never the thing that goes missing',
     visitBody('/about', null, null).path, '/about')

  // Optional does not mean "anything". A value that did not come from
  // randomSessionId() is sent as null rather than sent as it is, because the
  // database refuses a malformed one and that would cost the whole view.
  for (const bad of [
    'not-random',
    '11111111-1111-1111-1111-111111111111',
    'A'.repeat(32),          // upper-case hex is not the canonical spelling
    'a'.repeat(31),
    'a'.repeat(33),
    ' ' + 'a'.repeat(32),
  ]) {
    is(`a session id of the wrong shape is dropped, not sent: ${JSON.stringify(bad).slice(0, 22)}`,
       visitBody('/', bad, null).session, null)
  }

  is('the body is exactly three fields', Object.keys(visitBody('/', null, null)).sort(),
     ['path', 'ref', 'session'])
}

{
  const ids = new Set(Array.from({ length: 500 }, () => randomSessionId()))
  is('500 ids are 500 ids', ids.size, 500)
  ok('all of them are 16 bytes of hex', [...ids].every(isSessionId))
}

// ── And it is the only place anything is kept ──────────────────────────────
//
// Read from the source, because this is a guarantee about what the code does
// NOT do, and there is no call to make that returns "I did not set a cookie".
{
  const clientFiles = {
    'components/ViewTracker.tsx': readFileSync(`${ROOT}/components/ViewTracker.tsx`, 'utf8'),
    'lib/analytics/session.ts': readFileSync(`${ROOT}/lib/analytics/session.ts`, 'utf8'),
    'lib/analytics/visit.ts': readFileSync(`${ROOT}/lib/analytics/visit.ts`, 'utf8'),
  }

  for (const [name, source] of Object.entries(clientFiles)) {
    // Comments explain why these are not used, so the check is for USE: an
    // identifier followed by a property access or a call.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '')
    ok(`${name} never touches localStorage`, !/localStorage\s*[.[]/.test(code))
    ok(`${name} never touches a cookie`, !/document\s*\.\s*cookie/.test(code))
    ok(`${name} sets no persistent id another way`, !/indexedDB|openDatabase/.test(code))
  }

  // The fingerprinting surfaces, none of which anything here reads.
  const all = Object.values(clientFiles).join('\n')
  for (const probe of ['canvas', 'getImageData', 'hardwareConcurrency', 'deviceMemory',
                       'navigator.plugins', 'AudioContext', 'WebGL', 'screen.width']) {
    ok(`nothing reads ${probe}`, !all.includes(probe))
  }

  // The request body comes from `visitBody`, which is asserted directly above
  // — so the shape is checked by calling it rather than by reading a literal,
  // and this only has to confirm the tracker really uses it.
  const tracker = clientFiles['components/ViewTracker.tsx']
  ok('the tracker sends exactly what visitBody returns',
     /body:\s*JSON\.stringify\(visitBody\(/.test(tracker))
  ok('and builds no body of its own', !/JSON\.stringify\(\{/.test(tracker))

  // AND IT DOES NOT BAIL OUT WHEN THERE IS NO SESSION. This is a negative
  // assertion about control flow, in the file where the regression would go:
  // the early return that used to be here is what made a private window an
  // uncounted visitor. Everything between the session and the fetch must be
  // unconditional.
  const afterSession = tracker.slice(tracker.indexOf('browserSessionId()'))
  const beforeFetch = afterSession.slice(0, afterSession.indexOf("fetch('/api/view'"))
  ok('no early return between the session and the request',
     !/\breturn\b/.test(beforeFetch.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
     beforeFetch.trim().slice(0, 120))
}

// ════════════════════════════════════════════════════════════════════════════
// 5. THE PAGE MAP EXISTS TWICE AND THE TWO COPIES AGREE
// ════════════════════════════════════════════════════════════════════════════
//
// `record_page_view` has to carry its own key → address map, because validating
// the path against the resource is what it is for and it cannot import
// TypeScript. Two copies of one thing drift. Same assertion as `.mk/jobs.ts`
// makes about the queue's kind allow-list, and for the same reason.

{
  const migration = readFileSync(`${ROOT}/db/migrations/2026-09-29_analytics.sql`, 'utf8')

  const block = /v_expected := case p_page_key([\s\S]*?)end;/.exec(migration)
  ok('the migration still has a built-in page map', block !== null)

  if (block) {
    const sql = new Map(
      [...block[1]!.matchAll(/when\s+'([a-z]+)'\s+then\s+'([^']+)'/g)].map((m) => [m[1]!, m[2]!])
    )
    const ts = new Map(TRACKED_PAGE_KEYS.map((k) => [k as string, PAGES[k].path]))

    is(
      'the SQL page map matches PAGES',
      [...sql.entries()].sort(),
      [...ts.entries()].sort()
    )
  }

  // The regex in the CHECK constraint has to admit the same set of keys.
  const shape = /page_key ~\s*\n?\s*'\^\(([^)]*)\)/.exec(migration)
  ok('the page_key CHECK still names its keys', shape !== null)
  if (shape) {
    const allowed = shape[1]!.split('|').filter((k) => !k.startsWith('p_'))
    is('and they are the tracked built-ins', allowed.sort(), [...TRACKED_PAGE_KEYS].sort())
  }

  // The 404 page is the one entry in PAGES that is NOT tracked, and the reason
  // matters: it has no address, so counting it would mean writing every
  // mistyped address into `path` — an attacker-chosen string in a column the
  // photographer's dashboard reads.
  ok('notfound is a page of the editor', 'notfound' in PAGES)
  ok('and is not tracked', !TRACKED_PAGE_KEYS.includes('notfound' as never))
  is('it has no public address here', builtinPath('notfound'), null)
  is('and nothing resolves to it', builtinKeyAt('/404'), null)
}

// Every tracked built-in resolves both ways.
for (const key of TRACKED_PAGE_KEYS) {
  const path = builtinPath(key)
  ok(`${key} has an address`, path !== null, String(path))
  is(`and ${path} resolves back to ${key}`, builtinKeyAt(path!), key)
}

// ════════════════════════════════════════════════════════════════════════════
// 6. AND THE SAME AGAINST A REAL DATABASE
// ════════════════════════════════════════════════════════════════════════════

/** `.rpc()` over a real connection, AS SERVICE_ROLE — the route's own role. */
function adapter(client: Client): SupabaseClient {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      const keys = Object.keys(args)
      const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
      const values = keys.map((k) =>
        args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]
      )
      try {
        await client.query('set role service_role')
        const r = await client.query(`select public.${name}(${params}) as out`, values)
        return { data: r.rows[0]?.out ?? null, error: null }
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
      } finally {
        await client.query('reset role')
      }
    },
  } as unknown as SupabaseClient
}

/**
 * The three lookups, as the SAME SQL `liveLookups()` runs — including
 * `where tenant_id = $1`, which is the clause that makes another site's gallery
 * absent rather than refused.
 */
function lookups(client: Client, tenantId: string): SiteLookups {
  return {
    async albumBySlug(slug) {
      const r = await client.query(
        'select id, slug, privacy_type from albums where tenant_id = $1 and slug = $2',
        [tenantId, slug]
      )
      const row = r.rows[0]
      return row ? { id: row.id, slug: row.slug, privacy: row.privacy_type } : null
    },
    async postBySlug(slug) {
      const r = await client.query(
        "select id, slug from blog_posts where tenant_id = $1 and slug = $2 and status = 'published'",
        [tenantId, slug]
      )
      const row = r.rows[0]
      return row ? { id: row.id, slug: row.slug } : null
    },
    async customPages() {
      const r = await client.query('select custom_pages from site_settings where tenant_id = $1', [
        tenantId,
      ])
      const { sanitizeCustomPages } = await import('../lib/sections/pages')
      return sanitizeCustomPages(r.rows[0]?.custom_pages)
    },
  }
}

const VISITOR = 'e'.repeat(32)
const SESSION = '0'.repeat(32)
const never = () => false
const always = () => true

async function main() {
  const client = new Client({
    host: process.env.PGHOST ?? '/tmp',
    port: Number(process.env.PGPORT ?? 5433),
    database: process.env.PGDATABASE ?? 'wtp',
    user: process.env.PGUSER ?? 'postgres',
  })

  try {
    await client.connect()
  } catch (e) {
    console.log(`${pass + fail.length} assertions (pure half only)`)
    for (const f of fail) console.log('FAIL ' + f)
    console.log(`\n${pass} passed, ${fail.length} failed`)
    console.log(
      '\nSKIPPED the database half: no Postgres at ' +
        `${process.env.PGHOST ?? '/tmp'}:${process.env.PGPORT ?? 5433}. ` +
        'Build db/test-fixture.sql + both 2026-09-29 migrations and run again.\n' +
        (e instanceof Error ? e.message : String(e))
    )
    process.exit(fail.length ? 1 : 0)
  }

  const db = adapter(client)
  const lookA = lookups(client, TENANT_A)
  const lookB = lookups(client, TENANT_B)

  /** Every view this suite writes, gone — it commits, unlike the SQL one. */
  const wipe = async () => {
    await client.query(`delete from page_views where visitor_hash in ($1, $2)`, [VISITOR, 'f'.repeat(32)])
    await client.query(`update site_settings set custom_pages = '[]'::jsonb where tenant_id = any($1)`, [
      [TENANT_A, TENANT_B],
    ])
  }
  await wipe()

  const count = async (where: string, params: unknown[] = []) =>
    Number((await client.query(`select count(*)::int as n from page_views where ${where}`, params)).rows[0].n)

  const mine = () => count('visitor_hash = $1', [VISITOR])

  const visit = (path: string, access = never) => ({
    tenantId: TENANT_A,
    path,
    visitorHash: VISITOR,
    sessionHash: SESSION,
    device: 'desktop' as const,
    referrerHost: null,
    albumAccess: access,
  })

  is('the suite starts with none of its own rows', await mine(), 0)

  // ── 6a. every kind of public page, once each ───────────────────────────────

  await client.query(
    `update site_settings set custom_pages = $2::jsonb where tenant_id = $1`,
    [TENANT_A, JSON.stringify([{ key: 'p_a1b2c3d4', slug: 'weddings', title: 'Weddings' }])]
  )

  const cases: [string, string, string | null][] = [
    ['/', 'page_key', 'home'],
    ['/about', 'page_key', 'about'],
    ['/contact', 'page_key', 'contact'],
    ['/journal', 'page_key', 'journal'],
    ['/trips', 'page_key', 'galleries'],
    ['/shop', 'page_key', 'shop'],
    ['/weddings', 'page_key', 'p_a1b2c3d4'],
    ['/trips/public-gallery', 'album_id', ALBUM_A],
    ['/journal/first-light', 'post_id', POST_A],
  ]

  for (const [path, column, value] of cases) {
    const before = await mine()
    const out = await recordVisit(db, lookA, visit(path))
    const after = await mine()

    ok(`${path} records a view`, out.ok, JSON.stringify(out))
    is(`${path} writes exactly one row`, after - before, 1)

    const row = (
      await client.query(
        `select tenant_id, path, page_key, album_id, post_id, device, session_hash
           from page_views where visitor_hash = $1 order by viewed_at desc limit 1`,
        [VISITOR]
      )
    ).rows[0]

    is(`${path} is filed under the right identity`, row?.[column], value)
    is(`${path} stores its own pathname`, row?.path, path)
    is(`${path} belongs to this site`, row?.tenant_id, TENANT_A)
    is(`${path} carries the session`, row?.session_hash, SESSION)
  }

  is('nine pages, nine rows', await mine(), 9)

  // ── 6a2. and the same nine with no session at all ─────────────────────────
  //
  // The round trip for a browser that will not keep a per-tab value: through
  // `recordVisit`, through the real `record_page_view`, to a real row. Every
  // page kind, because a rule that held only for the homepage would be worse
  // than no rule.

  for (const [path, column, value] of cases) {
    const before = await mine()
    const out = await recordVisit(db, lookA, { ...visit(path), sessionHash: null })
    const after = await mine()

    ok(`${path} records without a session`, out.ok, JSON.stringify(out))
    is(`${path} still writes exactly one row`, after - before, 1)

    const row = (
      await client.query(
        `select path, page_key, album_id, post_id, session_hash, visitor_hash, device
           from page_views where visitor_hash = $1 order by viewed_at desc limit 1`,
        [VISITOR]
      )
    ).rows[0]

    is(`${path} stores no session`, row?.session_hash, null)
    is(`${path} keeps its identity anyway`, row?.[column], value)
    is(`${path} keeps the rest of the row`, [row?.path, row?.device],
       [path, 'desktop'])
  }

  is('eighteen rows now, not nine', await mine(), 18)
  is('and half of them have no session',
     await count('visitor_hash = $1 and session_hash is null', [VISITOR]), 9)

  // ── 6b. and the ones that are not a view ───────────────────────────────────
  //
  // Each of these must record NOTHING, and each for its own reason. Test 7 of
  // the brief is the first three: the admin, the editor and the preview are not
  // public visitor traffic, and the server is what says so — the browser's own
  // filter is a saved request, not the guarantee.

  const refusals: [string, ReturnType<typeof visit>][] = [
    ['the admin', visit('/admin')],
    ['a page of the admin', visit('/admin/settings')],
    ['the editor', visit('/edit/home')],
    ['the preview iframe', visit('/preview/about')],
    ['a share link', visit('/gallery/secret-token-here')],
    ['a review link', visit('/review/secret-token-here')],
    ['a single print', visit('/shop/cccccccc-0000-0000-0000-000000000001')],
    ['the API itself', visit('/api/view')],
    ['a mistyped address', visit('/abuot')],
    ['the 404 page by its editor path', visit('/404')],
    ['a gallery that does not exist', visit('/trips/ghost')],
    ['a story that does not exist', visit('/journal/ghost')],
    ['a client-only gallery', visit('/trips/private-gallery')],
    ['a deeper path than any page', visit('/trips/public-gallery/photos')],
  ]

  // `why` is asserted, not just `ok`. Without it the assertion passes for the
  // wrong reason: a resolver that lost its tenant filter would hand the
  // database a cross-tenant album, the database would refuse it, no row would
  // be written, and `ok === false` would look like success. Measured — that
  // exact mutation passed 215/215 before this line named the mechanism.
  // 'not-a-page' means it never became an identity at all.
  for (const [name, input] of refusals) {
    const before = await mine()
    const out = await recordVisit(db, lookA, input)
    is(`${name} is not a page at all`,
       [out.ok, out.ok ? null : out.why, (await mine()) - before],
       [false, 'not-a-page', 0])
  }

  // ── 6c. the boundary, from up here ────────────────────────────────────────
  //
  // Another site's gallery is not at any address on this one, so the spoof
  // CANNOT BE EXPRESSED rather than being caught: `/trips/other-site` resolves
  // to nothing when the lookups are scoped to site A.

  {
    const before = await mine()
    const out = await recordVisit(db, lookA, visit('/trips/other-site'))
    // 'not-a-page', emphatically, and not 'refused': the point is that the
    // address resolves to NOTHING on this site, so there is no identity for the
    // database to have to refuse. A resolver that found it and let the database
    // say no would also write no row, and would be one bug away from writing
    // one.
    is("another site's gallery is not at an address on this one",
       [out.ok, out.ok ? null : out.why, (await mine()) - before], [false, 'not-a-page', 0])
    is('and identify() says so directly', await identify(lookA, '/trips/other-site', never), null)

    // And it IS at an address on its own site, which is what proves the line
    // above is about ownership and not about a broken lookup.
    const theirs = await recordVisit(db, lookB, {
      ...visit('/trips/other-site'),
      tenantId: TENANT_B,
      visitorHash: 'f'.repeat(32),
    })
    ok('while on its own site it records normally', theirs.ok, JSON.stringify(theirs))
    is('filed against the right site', await count('visitor_hash = $1 and tenant_id = $2',
       ['f'.repeat(32), TENANT_B]), 1)
  }

  {
    // The same in the other direction, with the identity forced past the
    // resolver: the DATABASE refuses it. This is the assertion that would still
    // hold if lib/analytics/record.ts had a bug.
    const { error } = await db.rpc('record_page_view', {
      p_tenant: TENANT_A,
      p_path: '/trips/other-site',
      p_visitor: VISITOR,
      p_session: SESSION,
      p_device: 'desktop',
      p_page_key: null,
      p_album: 'bbbbbbbb-0000-0000-0000-000000000003',
      p_post: null,
      p_referrer_host: null,
    })
    ok('and the database refuses it even if this file were wrong',
       error !== null && /does not belong to site/.test(error.message),
       error?.message ?? 'ACCEPTED')
  }

  {
    // A custom page belonging to the other site, named from this one.
    await client.query(
      `update site_settings set custom_pages = $2::jsonb where tenant_id = $1`,
      [TENANT_B, JSON.stringify([{ key: 'p_b9b9b9b9', slug: 'elsewhere', title: 'Elsewhere' }])]
    )
    const before = await mine()
    const out = await recordVisit(db, lookA, visit('/elsewhere'))
    is("another site's page is not at an address on this one",
       [out.ok, out.ok ? null : out.why, (await mine()) - before], [false, 'not-a-page', 0])
    is('and identify() says so directly', await identify(lookA, '/elsewhere', never), null)
  }

  // ── 6d. the password gate, which the old tracker got for free ─────────────
  //
  // The old ViewTracker was rendered BELOW the gate, so a locked gallery could
  // not be counted. The new one is mounted once for the whole site and cannot
  // see the gate, so the gate is re-checked when the view is recorded. Without
  // this, every password gallery would accumulate views from people who only
  // ever saw a password box.

  {
    await client.query(
      `update albums set privacy_type = 'password', password_hash = 'x' where id = $1`,
      [LOCKED_A]
    )
    try {
      const before = await mine()
      const locked = await recordVisit(db, lookA, visit('/trips/private-gallery', never))
      is('a locked gallery records nothing',
         [locked.ok, locked.ok ? null : locked.why, (await mine()) - before],
         [false, 'not-a-page', 0])

      const opened = await recordVisit(db, lookA, visit('/trips/private-gallery', always))
      ok('and records once the visitor is through the gate', opened.ok, JSON.stringify(opened))
      is('filed against the gallery', await count('album_id = $1 and visitor_hash = $2',
         [LOCKED_A, VISITOR]), 1)
    } finally {
      await client.query(
        `update albums set privacy_type = 'client_only', password_hash = null where id = $1`,
        [LOCKED_A]
      )
    }
  }

  // ── 6e. an unpublished story is not a page ────────────────────────────────

  {
    await client.query(`update blog_posts set status = 'draft' where id = $1`, [POST_A])
    try {
      const before = await mine()
      const out = await recordVisit(db, lookA, visit('/journal/first-light'))
      is('a draft story records nothing',
         [out.ok, out.ok ? null : out.why, (await mine()) - before],
         [false, 'not-a-page', 0])
    } finally {
      await client.query(`update blog_posts set status = 'published' where id = $1`, [POST_A])
    }
  }

  // ── 6f. what identify() returns, on its own ───────────────────────────────

  is('the homepage identifies as the home page',
     await identify(lookA, '/', never), { kind: 'page', pageKey: 'home', path: '/' })
  is('a gallery identifies by id, with its own slug as the path',
     await identify(lookA, '/trips/public-gallery', never),
     { kind: 'album', albumId: ALBUM_A, path: '/trips/public-gallery' })
  is('a story identifies by id',
     await identify(lookA, '/journal/first-light', never),
     { kind: 'post', postId: POST_A, path: '/journal/first-light' })
  is('a custom page identifies by its stable key',
     await identify(lookA, '/weddings', never),
     { kind: 'page', pageKey: 'p_a1b2c3d4', path: '/weddings' })
  is('and an address of no page identifies as nothing',
     await identify(lookA, '/nowhere', never), null)

  // ── 6g. nothing was kept that should not have been ───────────────────────

  {
    const stored = (
      await client.query(
        `select distinct device from page_views where visitor_hash = $1 order by device`,
        [VISITOR]
      )
    ).rows.map((r) => r.device)
    ok('every device stored is one of three words',
       stored.every((d) => (DEVICES as readonly string[]).includes(d)), stored.join(', '))

    const columns = (
      await client.query(
        `select attname from pg_attribute where attrelid = 'public.page_views'::regclass
           and attnum > 0 and not attisdropped order by attnum`
      )
    ).rows.map((r) => r.attname)
    is('page_views has exactly these columns', columns, [
      'id', 'album_id', 'post_id', 'visitor_hash', 'viewed_at',
      'tenant_id', 'path', 'page_key', 'referrer_host', 'session_hash', 'device',
    ])
  }

  // ── 6h. and the recorder really was running as service_role ──────────────
  //
  // Every assertion above is worth exactly as much as this one. If the adapter
  // were quietly connecting as the owner, none of them would have tested a
  // privilege — which is how S3's first draft shipped a migration whose grants
  // would have failed in production.

  {
    await client.query('set role service_role')
    const who = (await client.query('select current_user as u')).rows[0].u
    await client.query('reset role')
    is("the recorder's calls run as service_role", who, 'service_role')

    await client.query('set role service_role')
    let direct = 'ALLOWED'
    try {
      await client.query(
        `insert into page_views (tenant_id, page_key, path, visitor_hash) values ($1,'home','/',$2)`,
        [TENANT_A, VISITOR]
      )
    } catch (e) {
      direct = e instanceof Error && /permission denied/.test(e.message) ? 'blocked' : 'other'
    }
    await client.query('reset role')
    is('and it cannot write a row of its own choosing', direct, 'blocked')
  }

  await wipe()
  is('and the suite leaves nothing behind', await mine(), 0)
  await client.end()
}

main().then(
  () => {
    console.log(`${pass + fail.length} assertions`)
    for (const f of fail) console.log('FAIL ' + f)
    console.log(`\n${pass} passed, ${fail.length} failed`)
    process.exit(fail.length ? 1 : 0)
  },
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
