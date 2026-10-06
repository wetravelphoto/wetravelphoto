import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { SECTIONS } from '../lib/sections/registry'
import { EXCLUDED_IMAGE_KEYS, extract, extractBlocks, extractSections, imageSlots } from '../lib/photos/extract'
import {
  MAX_ATTEMPTS,
  rebuildUsages,
  syncAlbum,
  syncDraft,
  syncLivePage,
  syncPost,
  syncUsages,
  type UsageRpc,
} from '../lib/photos/usages'
import { USAGE_KINDS } from '../lib/photos/usage-kinds'
import { main, parseArgs, runRebuild } from '../lib/photos/rebuild-cli'

/**
 * P3: WHERE EVERY PHOTOGRAPH IS USED, KEPT TRUE
 * ═════════════════════════════════════════════
 *
 * `db/verify-photo-usages.sql` proves the database boundary in one transaction.
 * This proves what one transaction cannot:
 *
 *   1. the extractor — which settings and blocks hold a photograph, from the
 *      registry at runtime; stored means referenced; block slots by index;
 *   2. the hooks — every writer of a photographic source is followed by its
 *      projection, and nothing else writes photo_usages;
 *   3. against a real Postgres, as `service_role`: the real syncUsages end to
 *      end, the stale-snapshot retry, a source that will not settle, the
 *      rebuild invariant over all eight kinds, and P2's gallery row;
 *   4. the two P2 wrappers are P2's, plus the lock and nothing else;
 *   5. CONCURRENCY, with two connections: an album sync racing
 *      register_gallery_photo and register_album_cover, both orders.
 *
 *   PGHOST=localhost PGPORT=5433 PGDATABASE=wtp PGUSER=postgres npx tsx .mk/usages.ts
 *
 * P3 is deployed (2026-10-01) and reconciled, so db/test-fixture.sql alone is
 * enough. With no database, parts 1 and 2 run and the rest SKIPS LOUDLY.
 */

const ROOT = resolve(__dirname, '..')

const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const TENANT_B = 'aaaaaaaa-0000-0000-0000-000000000002'
const USER_A = '11111111-1111-1111-1111-111111111111'
const ALBUM_A = 'bbbbbbbb-0000-0000-0000-000000000001'
const POST_A = 'dddddddd-0000-0000-0000-000000000001'
const PHOTO_1 = 'cccccccc-0000-0000-0000-000000000001'

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
// 1. THE EXTRACTOR
// ════════════════════════════════════════════════════════════════════════════

{
  // The slot map, pinned. It is DERIVED from the registry at runtime; pinning
  // it here is what notices when a registry change moves it.
  const want: Record<string, string[]> = {
    hero: ['image_path', 'image_path_mobile', 'video_poster*', 'video_poster_mobile*'],
    'hero-sequence': ['bg_image*'],
    mark: ['bg_image*'],
    intro: ['image_path', 'bg_image*'],
    about: ['image_path', 'bg_image*'],
    galleries: ['bg_image*'],
    journal: ['bg_image*'],
    shop: ['bg_image*'],
    instagram: ['bg_image*'],
    contact: ['image_path', 'bg_image*'],
  }
  const got: Record<string, string[]> = {}
  for (const type of Object.keys(SECTIONS)) {
    got[type] = imageSlots(type).map((s) => s.key + (s.decorative ? '*' : ''))
  }
  is('every section type\'s photograph slots (* = decorative)', got, want)

  ok('the hero video is excluded by key, desktop and phone',
    !Object.values(got).flat().some((k) => k.startsWith('video_path')))
  is('the only excluded key is the hero video', [...EXCLUDED_IMAGE_KEYS], ['video_path'])
  ok('mark.image_path (the accent mark, a custom editor) is not a slot', !got.mark!.includes('image_path'))

  // accessibilityRole: declared on exactly bg_image and the hero's video_poster.
  const declared: string[] = []
  for (const [type, def] of Object.entries(SECTIONS)) {
    for (const f of def.fields) if (f.accessibilityRole) declared.push(`${type}.${f.key}=${f.accessibilityRole}`)
  }
  is('accessibilityRole is declared on video_poster and bg_image only, all decorative',
    [...new Set(declared.map((d) => d.replace(/^[^.]+\./, '')))].sort(), ['bg_image=decorative', 'video_poster=decorative'])
}

{
  const hero = {
    type: 'hero',
    settings: {
      backdrop: 'video', // the photograph is kept while the hero shows a video
      image_path: 't/x/a/1600.webp',
      image_path_mobile: '',
      video_path: 't/x/v/clip.mp4',
      video_path_mobile: 't/x/v/clip-m.mp4',
      video_poster: 't/x/p/1600.webp',
      video_poster_mobile: 't/x/pm/800.webp',
    },
  }
  const refs = extractSections('home', [
    hero,
    { type: 'intro', visible: false, settings: { image_path: 't/x/b/1600.webp', hide_on: 'mobile', bg_image: 42 } },
    { type: 'no-such-type', settings: { image_path: 't/x/c/1600.webp' } },
    { type: 'contact-form', settings: { image_path: 't/x/d/1600.webp' } },
    'not a row',
  ])
  is('sections: stored means referenced — retained, hidden, retired-type; video, empty and non-strings are not',
    refs.map((r) => `${r.position}:${r.field}${r.decorative ? '*' : ''}`),
    ['0:image_path', '0:video_poster*', '0:video_poster_mobile*', '1:image_path', '3:image_path'])
  is('sections: the position is the ordinal in the page', refs.map((r) => r.position), [0, 0, 0, 1, 3])

  const old = extractSections('home', [{ type: 'hero', settings: { mode: 'stories', image_path: 't/x/e/1600.webp' } }])
  is('a hero written in the old "stories" mode still holds its photograph', old.map((r) => r.field), ['image_path'])
}

{
  const blocks = [
    { id: 'same', type: 'image', image: { path: 't/x/1/1600.webp', alt: 'A heron' } },
    { id: 'same', type: 'image_pair', left: { path: 't/x/2/1600.webp' }, right: { path: 't/x/3/1600.webp' } },
    { id: 'g', type: 'gallery', images: [{ path: '' }, { path: 't/x/4/1600.webp' }, { nope: 1 }, 'x'] },
    { id: 'm', type: 'masonry', images: 'not an array' },
    { id: 't', type: 'text', html: '<p>t/x/5/1600.webp</p>' },
    { id: 'i', type: 'image', image: { path: '' } },
    null,
  ]
  const { refs, malformed } = extractBlocks(blocks)
  is('blocks: field is block:<index>, never the id; positions per shape',
    refs.map((r) => `${r.field}@${r.position}`),
    ['block:0@0', 'block:1@0', 'block:1@1', 'block:2@1'])
  is('blocks: two blocks sharing an id are two slots', new Set(refs.map((r) => r.field)).size, 3)
  is('blocks: malformed image shapes are counted, not repaired', malformed, 3)
  is('blocks: no alt travels in a reference (the database reads it from the source)',
    refs.some((r) => 'alt' in r), false)
  is('blocks: not an array → nothing', extractBlocks({}).refs.length, 0)
}

{
  const d = extract({ parent: 'draft', exists: true, pages: {
    home: [{ type: 'intro', settings: { image_path: 't/x/1/1600.webp' } }],
    'Bad Key': [{ type: 'intro', settings: { image_path: 't/x/2/1600.webp' } }],
  } })
  is('draft: pages by key; a key that is not a page shape is counted, not sent',
    [d.refs.map((r) => (r as { page_key: string }).page_key), d.malformed], [['home'], 1])
  is('a deleted draft has no references', extract({ parent: 'draft', exists: false }).refs.length, 0)
  is('album and catalogue sources have no document references',
    [extract({ parent: 'album', exists: true }).refs.length, extract({ parent: 'catalog_item', exists: true }).refs.length], [0, 0])
  const kinds = new Set([
    ...extract({ parent: 'live_page', page: 'home', sections: [{ type: 'hero', settings: { image_path: 'a/b' } }] }).refs,
    ...extract({ parent: 'post', exists: true, blocks: [{ type: 'image', image: { path: 'a/b' } }] }).refs,
  ].map((r) => r.kind))
  is('the extractor only ever proposes page_section and story_block — never a share image, a gallery row or a cover',
    [...kinds].sort(), ['page_section', 'story_block'])
}

{
  // BUILT-IN SAMPLES (isSamplePhoto, lib/images.ts): never a reference.
  const S = '/samples/church/1600.webp'
  const sec = extractSections('home', [
    { type: 'hero', settings: { image_path: S, image_path_mobile: S, video_poster: S, video_poster_mobile: S } },
    { type: 'intro', settings: { image_path: S, bg_image: S } },
  ])
  is('sample section photographs (base, phone, background, posters): zero references', sec.length, 0)
  const blk = extractBlocks([
    { id: 'a', type: 'image', image: { path: S } },
    { id: 'b', type: 'image_pair', left: { path: S }, right: { path: S } },
    { id: 'c', type: 'gallery', images: [{ path: S }] },
  ])
  is('sample story photographs: zero references, nothing malformed', [blk.refs.length, blk.malformed], [0, 0])

  const live = extract({ parent: 'live_page', page: 'home', sections: [],
    legacy: { hero_image_path: S, intro_image_path: 'photos/2019/old.jpg', contact_image_path: null }, share: S })
  is('a sample legacy column and share image are DECLARED, so the database skips them; an old path is not',
    live.refs.map((r) => `${r.kind}:${r.field}`), ['sample:hero_image_path', 'sample:page_seo.image'])
  const draft = extract({ parent: 'draft', exists: true, pages: {}, page_seo: { about: { image: S }, contact: { image: 't/x/a/1600.webp' } } })
  is('a sample draft share image is declared; a real one is left to the database',
    draft.refs.map((r) => `${r.kind}:${r.page_key}`), ['sample:about'])
  const post = extract({ parent: 'post', exists: true, blocks: [], featured: S })
  is('a sample featured image is declared for its exact slot, and is no reference',
    post.refs, [{ kind: 'sample', position: 0, field: 'featured_custom_path', path: S }])
  is('a real featured image is left to the database (no declaration)',
    extract({ parent: 'post', exists: true, blocks: [], featured: 't/x/f/1600.webp' }).refs.length, 0)
  const album = extract({ parent: 'album', album: 'x', exists: true, photos: [
    { id: 'p1', storage_path: 't/x/photos/a/1/1600.webp' }, { id: 'p2', storage_path: S }, { id: 'p3', storage_path: null }] })
  is('album: only the sample photographs are named, by id and stored path — the database keeps the gallery',
    album.refs, [{ kind: 'sample', photo_id: 'p2', position: 0, field: 'photo', path: S }])
  is('catalogue: an entry made from a sample is named; a real one is not',
    [extract({ parent: 'catalog_item', photo: 'p2', exists: true, storage_path: S }).refs.length,
     extract({ parent: 'catalog_item', photo: 'p1', exists: true, storage_path: 't/x/1600.webp' }).refs.length], [1, 0])
  ok('a near-miss of the sample shape is NOT a sample (the rule is isSamplePhoto\'s, exactly)',
    extractSections('home', [{ type: 'intro', settings: { image_path: '/samples/church/1600.jpg' } }]).length === 1)

  // The rule is stated once, in lib/images.ts.
  const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')
  const extractSrc = src('lib/photos/extract.ts')
  ok('the extractor imports isSamplePhoto rather than restating it',
    extractSrc.includes("import { isSamplePhoto } from '@/lib/images'") && !extractSrc.includes('samples\\/'))
  const sqlCode = src('db/migrations/2026-09-30_photo_usages_sync.sql').split('\n')
    .filter((l) => !/^\s*--/.test(l)).join('\n')
  ok('the migration does not restate the sample rule either', !sqlCode.includes('/samples/'))
}

// ════════════════════════════════════════════════════════════════════════════
// 2. THE HOOKS
// ════════════════════════════════════════════════════════════════════════════

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
const SOURCES = ['app', 'lib', 'components'].flatMap((d) => walk(join(ROOT, d)))
const rel = (p: string) => relative(ROOT, p).split('\\').join('/')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

/** The text of the top-level function `name` in `file`. */
function fnBody(file: string, name: string): string {
  const src = read(file)
  const at = src.search(new RegExp(`\\n(export )?(async )?function ${name}\\b`))
  if (at < 0) return ''
  const end = src.indexOf('\n}\n', at)
  return src.slice(at, end < 0 ? undefined : end)
}

{
  const HOOKS: [string, string, string, number][] = [
    ['lib/sections/store.ts', 'materializeSections', 'syncLivePage(', 1],
    ['lib/sections/store.ts', 'replaceSections', 'syncLivePage(', 2],
    ['lib/site-patch.ts', 'patchSiteSettings', 'syncAfterSettings(', 1],
    ['lib/drafts/store.ts', 'upsertDraft', 'syncDraft(', 1],
    ['lib/drafts/store.ts', 'deleteDraft', 'syncDraft(', 1],
    ['app/actions/albums.ts', 'updateAlbumSettings', 'syncAlbum(', 1],
    ['app/actions/albums.ts', 'uploadCustomCover', 'syncAlbum(', 1],
    ['app/actions/albums.ts', 'clearCustomCover', 'syncAlbum(', 1],
    ['app/actions/photos.ts', 'deletePhoto', 'syncAlbum(', 1],
    ['app/actions/blog.ts', 'updatePost', 'syncPost(', 1],
    ['app/actions/blog.ts', 'duplicatePosts', 'syncPost(', 1],
    ['app/actions/catalog.ts', 'saveCatalogItem', 'syncCatalogItem(', 1],
    ['app/actions/catalog.ts', 'setCatalogPublished', 'syncCatalogItem(', 1],
    ['lib/products.ts', 'syncProductsForPhoto', 'syncCatalogItem(', 1],
    ['app/actions/sites.ts', 'createSite', 'syncAfterSettings(', 1],
    ['app/actions/sites.ts', 'seedSamples', 'syncAlbum(', 1],
    ['app/actions/sites.ts', 'seedSamples', 'syncPost(', 1],
    ['app/actions/sites.ts', 'fillHomepage', 'syncAfterSettings(', 1],
    ['app/actions/sites.ts', 'removeSamples', 'syncAlbum(', 1],
    ['app/actions/sites.ts', 'removeSamples', 'syncAfterSettings(', 1],
    ['app/actions/sites.ts', 'addSamples', 'syncDraft(', 1],
    ['app/actions/sites.ts', 'fillSections', 'syncLivePage(', 1],
  ]
  for (const [file, fn, call, n] of HOOKS) {
    const body = fnBody(file, fn)
    ok(`hook: ${file} ${fn} exists`, body.length > 0)
    is(`hook: ${fn} → ${call.slice(0, -1)} (${n})`, body.split(call).length - 1, n)
  }

  // Every write to a table that holds a photographic source is in a function
  // with a hook — or on this list, with the reason it needs none.
  const NO_HOOK: Record<string, string> = {
    'app/actions/sites.ts createSite site_settings.delete': 'the undo path: the tenant is deleted next, and its usages cascade with it',
    'app/actions/blog.ts deletePost blog_posts.delete': 'cascade: photo_usages_post_fk',
    'app/actions/blog.ts bulkDelete blog_posts.delete': 'cascade: photo_usages_post_fk',
    'app/actions/blog.ts bulkUpdateStatus blog_posts.update': 'status only — every saved story is `live` whatever its status',
    'app/actions/blog.ts createPost blog_posts.insert': 'a new story holds no photograph (no blocks, no featured image)',
    'app/actions/albums.ts createAlbum albums.insert': 'a new album has no photographs and no cover',
    'app/actions/albums.ts updateLayoutStyle albums.update': 'layout only',
    'app/actions/albums.ts uploadCoverVideo albums.update': 'a video — outside photo_assets in V1',
    'app/actions/albums.ts clearCoverVideo albums.update': 'a video — outside photo_assets in V1',
    'app/actions/galleries.ts deleteAlbum albums.delete': 'cascade: albums → photos → gallery usages; album → cover usages',
    'app/actions/galleries.ts reorderAlbums albums.update': 'display order only',
    'app/actions/photos.ts updateCaption photos.update': 'caption only',
    'app/actions/photos.ts updatePhotoTags photos.update': 'tags only',
    'app/actions/photos.ts toggleForSale photos.update': 'the flag only; syncProductsForPhoto, called next, projects the catalogue entry',
    'app/actions/photos.ts reorderPhotos photos.update': 'order only',
    'app/actions/sites.ts seedSamples albums.insert': 'projected at the end of seedSamples (syncAlbum)',
    'app/actions/sites.ts seedSamples photos.insert': 'projected at the end of seedSamples (syncAlbum)',
    'app/actions/sites.ts removeSamples albums.delete': 'cascade; and syncAlbum follows',
    'app/actions/sites.ts removeSamples photos.delete': 'cascade; and syncAlbum follows',
    'app/actions/sites.ts removeSamples albums.update': 'syncAlbum follows',
    'app/actions/sites.ts removeSamples site_settings.update': 'syncAfterSettings follows',
    'app/actions/sites.ts applyDefaultLook site_settings.update': 'styles only (global_styles, type_styles)',
    'app/actions/branding.ts updateBranding site_settings.update': 'the site title and owner name only',
    'app/actions/branding.ts uploadFavicon site_settings.update': 'furniture — not a photograph',
    'app/actions/branding.ts removeFavicon site_settings.update': 'furniture — not a photograph',
    'app/actions/instagram.ts saveInstagramToken site_settings.update': 'the Instagram handle — no photograph',
    'app/actions/instagram.ts disconnectInstagram site_settings.update': 'Instagram settings — no photograph',
    'app/actions/instagram.ts updateInstagramDisplay site_settings.update': 'Instagram display settings — no photograph',
    'app/actions/scenes.ts setShopRoom site_settings.update': 'a room scene — not a placement',
    'lib/instagram.ts syncInstagram site_settings.update': 'Instagram sync state — no photograph',
    'lib/instagram.ts refreshInstagramToken site_settings.update': "the token's expiry — no photograph",
    // (lib/jobs/derive.ts derivePhoto's photos.update was retired in P4: the
    // job now fails permanently and writes nothing.)
  }
  const TABLES = ['page_sections', 'site_draft', 'site_settings', 'albums', 'blog_posts', 'catalog_items', 'photos', 'photo_usages']
  const unhooked: string[] = []
  const directUsageWrites: string[] = []
  const seen = new Set<string>()
  for (const file of SOURCES) {
    const f = rel(file)
    if (f.startsWith('lib/photos/')) continue
    const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    for (const t of TABLES) {
      const re = new RegExp(`\\.from\\('${t}'\\)\\s*\\.(insert|update|delete|upsert)\\(`, 'g')
      for (const m of src.matchAll(re)) {
        if (t === 'photo_usages') {
          directUsageWrites.push(f)
          continue
        }
        // Enclosing function: the last `function name` before the write.
        const before = src.slice(0, m.index)
        const fns = [...before.matchAll(/\n(?:export )?(?:async )?function (\w+)/g)]
        const fn = fns.length ? fns[fns.length - 1]![1]! : '(top level)'
        const body = fnBody(f, fn)
        const hooked = /\bsync(LivePage|LivePages|Draft|Album|Post|CatalogItem|AfterSettings|Usages)\(/.test(body)
        const key = `${f} ${fn} ${t}.${m[1]}`
        seen.add(key)
        if (!hooked && !NO_HOOK[key]) unhooked.push(key)
      }
    }
  }
  is('every write of a photographic source is followed by its projection (or has a stated reason)', unhooked, [])
  is('nothing outside lib/photos writes photo_usages', directUsageWrites, [])
  is('every stated reason still names a real write (the list cannot go stale)',
    Object.keys(NO_HOOK).filter((k) => !seen.has(k)), [])

  // The sync functions are called from one module.
  const callers = SOURCES.filter((p) => /['"](sync_photo_usages|read_photo_usage_source|list_photo_usage_parents)['"]/.test(readFileSync(p, 'utf8'))).map(rel)
  is('only lib/photos/usages.ts calls the projection functions', callers, ['lib/photos/usages.ts'])
  const code = read('lib/photos/usages.ts').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  const admin = code.match(/createAdminClient\(\)/g)?.length ?? 0
  is('lib/photos/usages.ts uses the service role in exactly one place', admin, 1)

  // accessibilityRole is metadata: nothing renders it, no panel shows it.
  const readers = SOURCES.filter((p) => /accessibilityRole/.test(readFileSync(p, 'utf8'))).map(rel).sort()
  is('accessibilityRole is read by the registry and the extractor only — no UI, no renderer',
    readers, ['lib/photos/extract.ts', 'lib/sections/registry.ts'])
}

// ════════════════════════════════════════════════════════════════════════════
// 2b. THE REBUILD COMMAND (scripts/rebuild-photo-usages.ts)
// ════════════════════════════════════════════════════════════════════════════

const T1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const T2 = 'aaaaaaaa-0000-0000-0000-000000000002'
const report = (failed = 0) => ({ parents: 3, failed, written: 2, unresolved: 1 })

/** A fake world that records what was asked of it. */
function fakeDeps(opts: { tenants?: string[]; failFor?: string[] } = {}) {
  const calls: string[] = []
  const lines: string[] = []
  let active = 0
  let maxActive = 0
  return {
    calls, lines,
    get maxActive() { return maxActive },
    deps: {
      rebuild: async (t: string) => {
        calls.push(`rebuild ${t}`)
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
        return report(opts.failFor?.includes(t) ? 1 : 0)
      },
      listTenants: async () => {
        calls.push('list')
        return opts.tenants ?? []
      },
      out: (l: string) => void lines.push(l),
    },
  }
}

async function cli() {
  {
    const script = read('scripts/rebuild-photo-usages.ts')
    const lib = read('lib/photos/rebuild-cli.ts')
    ok('the script only runs lib/photos/rebuild-cli.ts main()',
      script.includes("import { main } from '../lib/photos/rebuild-cli'") && script.includes('main(process.argv.slice(2))'))
    ok('the command calls the existing rebuildUsages',
      lib.includes("import { createAdminClient } from '@/lib/supabase/admin'") &&
      /import \{ rebuildUsages[^}]*\} from '@\/lib\/photos\/usages'/.test(lib) && lib.includes('rebuildUsages(tenantId,'))
    const code = (t: string) => t.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
    is('no second implementation: neither file names a projection function, the extractor, the resolver or a usage table',
      [script, lib].map((t) => /sync_photo_usages|read_photo_usage_source|list_photo_usage_parents|photo_usage_resolve|from '@\/lib\/photos\/extract'|photo_usages|\.rpc\(/.test(code(t))),
      [false, false])
    ok('no route, action or page reaches it', SOURCES.every((p) => !readFileSync(p, 'utf8').includes('rebuild-cli') || rel(p) === 'lib/photos/rebuild-cli.ts'))
  }

  // Arguments: exactly one of --tenant <uuid> / --all, refused BEFORE any work.
  const refused: [string, string[]][] = [
    ['neither flag', []],
    ['both flags', ['--tenant', T1, '--all']],
    ['both flags, other order', ['--all', '--tenant', T1]],
    ['a malformed uuid', ['--tenant', 'not-a-uuid']],
    ['a uuid with a trailing character', ['--tenant', T1 + 'x']],
    ['--tenant with no value', ['--tenant']],
    ['--tenant followed by a flag', ['--tenant', '--all']],
    ['--tenant twice', ['--tenant', T1, '--tenant', T2]],
    ['an unknown argument', ['--everything']],
  ]
  for (const [name, argv] of refused) {
    let built = false
    const errs: string[] = []
    const code = await main(argv, () => {
      built = true
      return fakeDeps().deps
    }, (l) => void errs.push(l))
    is(`CLI: ${name} → refused (exit 2), with the usage, before anything is connected`,
      [code, built, errs.length === 1 && errs[0]!.includes('usage:')], [2, false, true])
  }
  is('CLI: --tenant <uuid> parses (lower-cased)', parseArgs(['--tenant', T1.toUpperCase()]), { ok: true, target: { mode: 'tenant', tenant: T1 } })
  is('CLI: --all parses', parseArgs(['--all']), { ok: true, target: { mode: 'all' } })

  // A missing service-role key is refused through the existing admin path.
  {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const errs: string[] = []
    const code = await main(['--tenant', T1], undefined, (l) => void errs.push(l))
    if (saved !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved
    is('CLI: no SUPABASE_SERVICE_ROLE_KEY → exit 2, said plainly', [code, errs.some((e) => e.includes('SUPABASE_SERVICE_ROLE_KEY'))], [2, true])
  }

  // --tenant: that site, and only that site.
  {
    const f = fakeDeps({ tenants: [T1, T2] })
    const code = await runRebuild({ mode: 'tenant', tenant: T2 }, f.deps)
    is('CLI --tenant: rebuilds exactly that site and never lists the others', f.calls, [`rebuild ${T2}`])
    is('CLI --tenant: prints tenant, parents, failed, written, unresolved', f.lines,
      [`tenant ${T2}  parents 3  failed 0  written 2  unresolved 1`])
    is('CLI --tenant: exit 0 when nothing failed', code, 0)
    const g = fakeDeps({ failFor: [T1] })
    is('CLI --tenant: exit 1 when a parent failed', await runRebuild({ mode: 'tenant', tenant: T1 }, g.deps), 1)
  }

  // --all: every site, one at a time, a report each and a total.
  {
    const f = fakeDeps({ tenants: [T1, T2, 'aaaaaaaa-0000-0000-0000-000000000003'] })
    const code = await runRebuild({ mode: 'all' }, f.deps)
    is('CLI --all: lists the sites once, then rebuilds each in order', f.calls,
      ['list', `rebuild ${T1}`, `rebuild ${T2}`, 'rebuild aaaaaaaa-0000-0000-0000-000000000003'])
    is('CLI --all: sequentially — never two at once', f.maxActive, 1)
    is('CLI --all: one line per site plus the total', f.lines.length, 4)
    ok('CLI --all: the total adds them up', f.lines[3]!.startsWith('total  sites 3  failed sites 0  parents 9  failed 0  written 6  unresolved 3'), f.lines[3])
    is('CLI --all: exit 0 when nothing failed', code, 0)
    const g = fakeDeps({ tenants: [T1, T2], failFor: [T2] })
    is('CLI --all: exit 1 when any site had a failed parent — and the rest still ran',
      [await runRebuild({ mode: 'all' }, g.deps), g.calls], [1, ['list', `rebuild ${T1}`, `rebuild ${T2}`]])
    const h = fakeDeps()
    h.deps.listTenants = async () => { throw new Error('no network') }
    is('CLI --all: the sites cannot be listed → exit 1', await runRebuild({ mode: 'all' }, h.deps), 1)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3–5. AGAINST A REAL POSTGRES
// ════════════════════════════════════════════════════════════════════════════

const PG = {
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  database: process.env.PGDATABASE ?? 'wtp',
  user: process.env.PGUSER ?? 'postgres',
}

const param = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)

/** The projection service, as PostgREST runs it: one transaction per call, as service_role. */
function serviceRpc(client: Client, before?: (fn: string) => Promise<void>): UsageRpc {
  return {
    rpc: async (fn, args) => {
      if (before) await before(fn)
      const names = Object.keys(args)
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`
      await client.query('begin')
      try {
        await client.query('set local role service_role')
        const r = await client.query(sql, names.map((n) => param(args[n])))
        await client.query('commit')
        return { data: r.rows[0].v, error: null }
      } catch (e) {
        await client.query('rollback')
        return { data: null, error: { message: (e as Error).message } }
      }
    },
  }
}

/** A register_* call as the signed-in photographer, optionally left open. */
async function asPhotographer(client: Client, fn: string, args: Record<string, unknown>, hold = false) {
  const names = Object.keys(args)
  await client.query('begin')
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USER_A })])
    await client.query('set local role authenticated')
    await client.query(`select * from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`, names.map((n) => param(args[n])))
    if (hold) return { error: null as string | null, commit: async () => void (await client.query('commit')) }
    await client.query('commit')
    return { error: null as string | null, commit: async () => {} }
  } catch (e) {
    await client.query('rollback')
    return { error: (e as Error).message, commit: async () => {} }
  }
}

/** An album sync in ONE transaction as service_role, optionally left open. */
async function albumSyncHeld(client: Client, album: string, hold: boolean) {
  await client.query('begin')
  try {
    await client.query('set local role service_role')
    const src = (await client.query(`select public.read_photo_usage_source($1, 'album', $2) as v`, [TENANT_A, album])).rows[0].v
    const r = (await client.query(`select public.sync_photo_usages($1, 'album', $2, $3, '[]') as v`, [TENANT_A, album, src])).rows[0].v
    if (!hold) await client.query('commit')
    return { reply: r as { stale: boolean; written: number }, commit: async () => void (await client.query('commit')) }
  } catch (e) {
    await client.query('rollback')
    return { reply: null, error: (e as Error).message, commit: async () => {} }
  }
}

const logSink = () => {
  const lines: string[] = []
  return { lines, log: { warn: (...a: unknown[]) => lines.push('warn ' + JSON.stringify(a)), error: (...a: unknown[]) => lines.push('error ' + JSON.stringify(a)) } }
}

const kb = (t: string, u: string, route = 'site-images') => `t/${t}/${route}/${u}`

async function database() {
  const owner = new Client(PG)
  try {
    await owner.connect()
  } catch (e) {
    console.log(`\nSKIPPED the database half: no Postgres at ${PG.host}:${PG.port}.\n` + (e instanceof Error ? e.message : String(e)))
    return
  }
  const has = await owner.query(`select to_regprocedure('public.sync_photo_usages(uuid, text, text, text, jsonb)') is not null as there`)
  if (!has.rows[0].there) {
    fail.push('sync_photo_usages does not exist — apply the two P3 migrations to this database first')
    await owner.end()
    return
  }

  const svc = new Client(PG)
  await svc.connect()
  const deps = (extra: Partial<{ log: ReturnType<typeof logSink>['log'] }> = {}) => ({ rpc: serviceRpc(svc), log: logSink().log, ...extra })

  const logical = async (tenant: string) =>
    (await owner.query(
      `select format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', scope, kind, asset_id, photo_id, album_id, post_id, product_id,
                     page_key, field, position, coalesce(alt_override, '∅'), decorative) as r
         from photo_usages where tenant_id = $1 order by 1`, [tenant])).rows.map((r) => r.r as string)

  // A photograph asset on a site, as P2 would have written it.
  const asset = async (tenant: string, route = 'site-images') => {
    const base = kb(tenant, randomUUID(), route)
    const id = (await owner.query(
      `insert into photo_assets (tenant_id, key_base, original_path, display_path, derivatives, state)
       values ($1, $2, $2 || '/original.jpg', $2 || '/1600.webp',
               jsonb_build_object('400', $2 || '/400.webp', '1600', $2 || '/1600.webp'), 'derived') returning id`,
      [tenant, base])).rows[0].id as string
    return { id, base, display: `${base}/1600.webp`, small: `${base}/400.webp` }
  }

  // The fixture's own state for everything this suite writes, restored before
  // and after, so the suite can run twice against one database.
  const FIXTURE_PHOTOS = [PHOTO_1, 'cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003']
  const reset = async () => {
    await owner.query(`delete from photo_usages`)
    await owner.query(`delete from catalog_items where tenant_id = $1`, [TENANT_A])
    await owner.query(`delete from photos where tenant_id = $1 and not (id = any ($2::uuid[]))`, [TENANT_A, FIXTURE_PHOTOS])
    await owner.query(`delete from albums where tenant_id = $1 and not (id = any ($2::uuid[]))`,
      [TENANT_A, [ALBUM_A, 'bbbbbbbb-0000-0000-0000-000000000002']])
    await owner.query(`delete from blog_posts where tenant_id = $1 and id <> $2`, [TENANT_A, POST_A])
    await owner.query(`update photos set asset_id = null where id = any ($1::uuid[])`, [FIXTURE_PHOTOS])
    await owner.query(`delete from photo_assets where tenant_id in ($1, $2)`, [TENANT_A, TENANT_B])
    await owner.query(`update albums set cover_photo_id = $2, cover_custom_path = null where id = $1`, [ALBUM_A, PHOTO_1])
    await owner.query(`update blog_posts set featured_custom_path = null, blocks = '[]' where id = $1`, [POST_A])
    await owner.query(`delete from page_sections where tenant_id in ($1, $2)`, [TENANT_A, TENANT_B])
    await owner.query(`insert into page_sections (tenant_id, page, type, position, settings) values ($1, 'home', 'hero', 0, '{}')`, [TENANT_A])
    await owner.query(`update site_settings set page_seo = '{}', hero_image_path = null, intro_image_path = null,
                              contact_image_path = null, about_image_path = null where tenant_id = $1`, [TENANT_A])
    await owner.query(`update site_draft set pages = '{}', page_seo = null where tenant_id = $1`, [TENANT_A])
  }

  try {
    await reset()
    await owner.query(`delete from page_sections where tenant_id = $1`, [TENANT_A])
    await owner.query(`update site_settings set page_seo = '{}', hero_image_path = null, intro_image_path = null,
                              contact_image_path = null, about_image_path = null where tenant_id = $1`, [TENANT_A])
    await owner.query(`update profiles set is_platform_admin = false`)

    const A1 = await asset(TENANT_A)
    const A2 = await asset(TENANT_A)
    const A3 = await asset(TENANT_A)
    const B1 = await asset(TENANT_B)

    // ── 3a. syncUsages end to end, with the real extractor ─────────────────
    await owner.query(
      `insert into page_sections (tenant_id, page, type, position, settings) values
         ($1, 'home', 'hero', 0, $2), ($1, 'home', 'intro', 1, $3)`,
      [TENANT_A,
       { backdrop: 'video', image_path: A1.display, image_path_mobile: A2.small, video_path: A3.base + '/original.jpg', video_poster: A3.display, video_poster_mobile: A3.small },
       { image_path: A2.display, bg_image: B1.display, hide_on: 'mobile' }])
    const sink = logSink()
    const r1 = await syncLivePage(TENANT_A, 'home', { rpc: serviceRpc(svc), log: sink.log })
    is('syncUsages: home projected — 5 written, the other site\'s photograph unresolved',
      r1.ok ? [r1.written, r1.unresolved, r1.attempts] : r1, [5, 1, 1])
    is('syncUsages: the rows, decorative mirrored from the registry',
      (await owner.query(`select position || ':' || field || case when decorative then '*' else '' end as r from photo_usages
                           where tenant_id = $1 and kind = 'page_section' order by position, field`, [TENANT_A])).rows.map((r) => r.r),
      ['0:image_path', '0:image_path_mobile', '0:video_poster*', '0:video_poster_mobile*', '1:image_path'])
    ok('syncUsages: the unresolved reference was logged with its site and parent',
      sink.lines.some((l) => l.startsWith('warn') && l.includes('unresolved') && l.includes(TENANT_A) && l.includes('live_page')))
    is('no stored share image: no page_share (the automatic fallback is not a usage)',
      (await owner.query(`select count(*)::int n from photo_usages where tenant_id = $1 and kind = 'page_share'`, [TENANT_A])).rows[0].n, 0)

    // Two sections of one type on one page are two slots; a move re-projects.
    await owner.query(
      `insert into page_sections (tenant_id, page, type, position, settings) values
         ($1, 'about', 'intro', 0, $2), ($1, 'about', 'intro', 1, $3), ($1, 'about', 'contact', 2, $4)`,
      [TENANT_A, { image_path: A1.display }, { image_path: A2.display }, { image_path: A3.display }])
    await syncLivePage(TENANT_A, 'about', deps())
    const aboutRows = async () =>
      (await owner.query(`select u.position || ':' || u.field || '=' || right(pa.key_base, 4) as r from photo_usages u
                           join photo_assets pa on pa.id = u.asset_id
                          where u.tenant_id = $1 and u.page_key = 'about' order by u.position`, [TENANT_A])).rows.map((r) => r.r)
    is('two intro sections, both with a photograph: two distinct usages',
      await aboutRows(), [`0:image_path=${A1.base.slice(-4)}`, `1:image_path=${A2.base.slice(-4)}`, `2:image_path=${A3.base.slice(-4)}`])
    // Move the contact section from position 2 to position 0 (what a drag + publish does).
    await owner.query(`update page_sections set position = case type when 'contact' then 0 else position + 1 end
                        where tenant_id = $1 and page = 'about'`, [TENANT_A])
    await syncLivePage(TENANT_A, 'about', deps())
    is('a section moved from 2 to 0 re-projects under its new ordinal, no duplicate',
      await aboutRows(), [`0:image_path=${A3.base.slice(-4)}`, `1:image_path=${A1.base.slice(-4)}`, `2:image_path=${A2.base.slice(-4)}`])
    await owner.query(`delete from page_sections where tenant_id = $1 and page = 'about'`, [TENANT_A])
    await syncLivePage(TENANT_A, 'about', deps())
    is('the page emptied: its usages go', (await aboutRows()).length, 0)

    // ── 3a′. Built-in samples, end to end: ignored, not unresolved ──────────
    {
      const SAMPLE = '/samples/church/1600.webp'
      await owner.query(`update site_settings set about_image_path = $2, page_seo = $3 where tenant_id = $1`,
        [TENANT_A, SAMPLE, JSON.stringify({ about: { image: SAMPLE } })])
      await owner.query(`insert into page_sections (tenant_id, page, type, position, settings) values ($1, 'contact', 'contact', 0, $2)`,
        [TENANT_A, { image_path: SAMPLE, bg_image: SAMPLE }])
      await owner.query(`update site_draft set pages = $2, page_seo = $3 where tenant_id = $1`,
        [TENANT_A, JSON.stringify({ home: [{ id: 's', type: 'hero', settings: { image_path: SAMPLE, video_poster: SAMPLE } }] }),
         JSON.stringify({ contact: { image: SAMPLE } })])
      await owner.query(`update blog_posts set blocks = $2 where id = $1`,
        [POST_A, JSON.stringify([{ id: 'x', type: 'image_pair', left: { path: SAMPLE }, right: { path: SAMPLE } }])])

      const sk = logSink()
      const d = { rpc: serviceRpc(svc), log: sk.log }
      const results = [
        await syncLivePage(TENANT_A, 'about', d),   // live legacy + live share
        await syncLivePage(TENANT_A, 'contact', d), // section image + background
        await syncDraft(TENANT_A, d),               // draft section + draft share
        await syncPost(TENANT_A, POST_A, d),        // story blocks
      ]
      is('samples everywhere: every sync succeeds, writes nothing, leaves nothing unresolved or malformed',
        results.map((r) => (r.ok ? `${r.written}/${r.unresolved}/${r.malformed}` : r.reason)), ['0/0/0', '0/0/0', '0/0/0', '0/0/0'])
      is('…and no usage row names them',
        (await owner.query(`select count(*)::int n from photo_usages where tenant_id = $1
                             and (page_key in ('about', 'contact') or scope = 'draft' or post_id = $2)`, [TENANT_A, POST_A])).rows[0].n, 0)
      is('…and no unresolved warning was logged', sk.lines.filter((l) => l.startsWith('warn')).length, 0)

      // An old path that is NOT a sample is still unresolved, counted and logged.
      await owner.query(`update site_settings set about_image_path = 'photos/2019/old-about.jpg' where tenant_id = $1`, [TENANT_A])
      const old = await syncLivePage(TENANT_A, 'about', d)
      is('a random old non-sample path still counts as unresolved', old.ok ? old.unresolved : old, 1)
      ok('…and is logged', sk.lines.some((l) => l.startsWith('warn') && l.includes('old-about.jpg')))

      await owner.query(`update site_settings set about_image_path = null, page_seo = '{}' where tenant_id = $1`, [TENANT_A])
      await owner.query(`delete from page_sections where tenant_id = $1 and page = 'contact'`, [TENANT_A])
      await owner.query(`update site_draft set pages = '{}', page_seo = null where tenant_id = $1`, [TENANT_A])
      await owner.query(`update blog_posts set blocks = '[]' where id = $1`, [POST_A])
      for (const page of ['about', 'contact']) await syncLivePage(TENANT_A, page, deps())
      await syncDraft(TENANT_A, deps())
      await syncPost(TENANT_A, POST_A, deps())
    }

    // ── 3a″. Sample photographs rows and a sample story cover ───────────────
    // Left in place on purpose: the rebuild below must ignore them too.
    const SAMPLES = ['church', 'gull', 'oriole'].map((s) => `/samples/${s}/1600.webp`)
    const sampleAlbum = (await owner.query(
      `insert into albums (tenant_id, title, slug, privacy_type) values ($1, 'Samples', 'samples-p3', 'public') returning id`,
      [TENANT_A])).rows[0].id as string
    const sampleIds: string[] = []
    for (const [i, p] of SAMPLES.entries()) {
      sampleIds.push((await owner.query(
        `insert into photos (tenant_id, album_id, storage_path, sort_order) values ($1, $2, $3, $4) returning id`,
        [TENANT_A, sampleAlbum, p, i])).rows[0].id as string)
    }
    // As seedSamples does: the first sample is the chosen cover.
    await owner.query(`update albums set cover_photo_id = $2 where id = $1`, [sampleAlbum, sampleIds[0]])
    const sampleStory = (await owner.query(
      `insert into blog_posts (tenant_id, title, slug, status, featured_custom_path, blocks)
       values ($1, 'Sample', 'sample-p3', 'draft', $2, $3) returning id`,
      [TENANT_A, SAMPLES[1], JSON.stringify([{ id: 'x', type: 'image', image: { path: SAMPLES[2] } }])])).rows[0].id as string
    {
      const sk = logSink()
      const d = { rpc: serviceRpc(svc), log: sk.log }
      const r = await syncAlbum(TENANT_A, sampleAlbum, d)
      is('a sample gallery whose chosen cover is a sample: written 0, unresolved 0, malformed 0',
        r.ok ? [r.written, r.unresolved, r.malformed] : r, [0, 0, 0])
      is('…no gallery or cover usage for it', (await owner.query(
        `select count(*)::int n from photo_usages where album_id = $1 or photo_id = any ($2::uuid[])`, [sampleAlbum, sampleIds])).rows[0].n, 0)
      const p = await syncPost(TENANT_A, sampleStory, d)
      is('a sample story (featured image and block): written 0, unresolved 0, malformed 0',
        p.ok ? [p.written, p.unresolved, p.malformed] : p, [0, 0, 0])
      is('…no story usage', (await owner.query(`select count(*)::int n from photo_usages where post_id = $1`, [sampleStory])).rows[0].n, 0)
      is('…and nothing was logged as unresolved', sk.lines.filter((l) => l.startsWith('warn')).length, 0)

      // MIXED: a canonical (asset-backed) photograph joins the samples.
      const real = await asset(TENANT_A)
      const realPhoto = (await owner.query(
        `insert into photos (tenant_id, album_id, storage_path, sort_order, asset_id) values ($1, $2, $3, 9, $4) returning id`,
        [TENANT_A, sampleAlbum, real.display, real.id])).rows[0].id as string
      const m = await syncAlbum(TENANT_A, sampleAlbum, d)
      is('mixed album: the canonical photograph\'s gallery usage only, samples absent, unresolved 0',
        [m.ok ? [m.written, m.unresolved] : m,
         (await owner.query(`select photo_id from photo_usages where kind = 'gallery' and photo_id = any ($1::uuid[])`,
           [[...sampleIds, realPhoto]])).rows.map((x) => x.photo_id)],
        [[1, 0], [realPhoto]])
      // A non-sample row with no asset (pre-P2) is still counted.
      const old = (await owner.query(
        `insert into photos (tenant_id, album_id, storage_path, sort_order) values ($1, $2, 'photos/2017/old.jpg', 10) returning id`,
        [TENANT_A, sampleAlbum])).rows[0].id as string
      const n = await syncAlbum(TENANT_A, sampleAlbum, d)
      is('a non-sample photograph with asset_id NULL is still unresolved', n.ok ? n.unresolved : n, 1)
      await owner.query(`delete from photos where id = any ($1::uuid[])`, [[old, realPhoto]])
      await syncAlbum(TENANT_A, sampleAlbum, d)

      // An old non-sample featured image is still counted.
      await owner.query(`update blog_posts set featured_custom_path = 'journal/2016/old.jpg' where id = $1`, [sampleStory])
      const o = await syncPost(TENANT_A, sampleStory, d)
      is('an old non-sample featured path is still unresolved', o.ok ? o.unresolved : o, 1)
      await owner.query(`update blog_posts set featured_custom_path = $2 where id = $1`, [sampleStory, SAMPLES[1]])
      await syncPost(TENANT_A, sampleStory, d)
    }

    // ── 3b. STALE: a newer save lands between the read and the sync ─────────
    let raced = false
    const racing = serviceRpc(svc, async (fn) => {
      if (fn === 'sync_photo_usages' && !raced) {
        raced = true
        await owner.query(`update page_sections set settings = settings || jsonb_build_object('image_path', $2::text)
                            where tenant_id = $1 and page = 'home' and type = 'hero'`, [TENANT_A, A3.display])
      }
    })
    const r2 = await syncUsages(TENANT_A, 'live_page', 'home', { rpc: racing, log: logSink().log })
    is('a snapshot overtaken by a newer save is refused, re-read and retried', r2.ok ? r2.attempts : r2, 2)
    is('…and the NEWER document is what is projected',
      (await owner.query(`select pa.display_path from photo_usages u join photo_assets pa on pa.id = u.asset_id
                           where u.tenant_id = $1 and u.kind = 'page_section' and u.position = 0 and u.field = 'image_path'`, [TENANT_A])).rows[0]?.display_path,
      A3.display)

    // A source that never settles: bounded, logged, and the save stands.
    const churn = serviceRpc(svc, async (fn) => {
      if (fn === 'sync_photo_usages') {
        await owner.query(`update page_sections set settings = settings || jsonb_build_object('churn', gen_random_uuid()::text)
                            where tenant_id = $1 and page = 'home' and type = 'hero'`, [TENANT_A])
      }
    })
    const churnLog = logSink()
    const r3 = await syncUsages(TENANT_A, 'live_page', 'home', { rpc: churn, log: churnLog.log })
    is('a source that keeps changing: gives up after MAX_ATTEMPTS, reports stale, does not throw',
      r3.ok ? 'ok' : [r3.reason, r3.attempts], ['stale', MAX_ATTEMPTS])
    ok('…and says so in the log', churnLog.lines.some((l) => l.startsWith('error') && l.includes('kept changing')))
    await owner.query(`update page_sections set settings = settings - 'churn' where tenant_id = $1`, [TENANT_A])

    // A failing database: logged, not thrown.
    const broken: UsageRpc = { rpc: async () => ({ data: null, error: { message: 'connection reset' } }) }
    const errLog = logSink()
    const r4 = await syncAlbum(TENANT_A, ALBUM_A, { rpc: broken, log: errLog.log })
    is('a failed sync returns an error, never throws', r4.ok ? 'ok' : r4.reason, 'error')
    ok('…logged with its site, scope and parent', errLog.lines.some((l) => l.includes(TENANT_A) && l.includes('"scope":"live"') && l.includes('album')))
    const r5 = await syncAlbum(TENANT_A, ALBUM_A, { rpc: { rpc: () => { throw new Error('boom') } }, log: logSink().log })
    is('even a client that throws does not escape', r5.ok ? 'ok' : r5.reason, 'error')

    // ── 3c. P2's gallery row is the rebuild's gallery row ───────────────────
    const u = randomUUID()
    const gbase = kb(TENANT_A, u, `photos/${ALBUM_A}`)
    const reg = await asPhotographer(svc, 'register_gallery_photo', galleryArgs(gbase))
    is('register_gallery_photo (P2, now locked) still registers as the photographer', reg.error, null)
    const newPhoto = (await owner.query(`select p.id from photos p join photo_assets a on a.id = p.asset_id where a.key_base = $1`, [gbase])).rows[0]?.id as string
    const mine = (rows: string[]) => rows.filter((r) => r.includes('|gallery|') && r.includes(`|${newPhoto}|`))
    const p2Gallery = mine(await logical(TENANT_A))
    is('P2 wrote the gallery row on upload', p2Gallery.length, 1)
    await syncAlbum(TENANT_A, ALBUM_A, deps())
    is('the album sync reproduces P2\'s immediate gallery row exactly, once', mine(await logical(TENANT_A)), p2Gallery)

    // ── 3d. THE INVARIANT: all eight kinds, deleted and rebuilt ─────────────
    // Build every kind on site A through its real sources.
    await owner.query(`update photos set asset_id = $2 where id = $1`, [PHOTO_1, A1.id])
    await owner.query(`update albums set cover_photo_id = $2, cover_custom_path = $3 where id = $1`, [ALBUM_A, PHOTO_1, A2.display])
    await owner.query(`update blog_posts set featured_custom_path = $2, blocks = $3 where id = $1`,
      [POST_A, A1.display, JSON.stringify([{ id: 'x', type: 'image', image: { path: A2.display, alt: 'A heron' } },
                                           { id: 'x', type: 'gallery', images: [{ path: A3.small }, { path: 'legacy/1.jpg' }] }])])
    await owner.query(`insert into catalog_items (tenant_id, photo_id) values ($1, $2) on conflict (photo_id) do nothing`, [TENANT_A, PHOTO_1])
    await owner.query(`update site_settings set about_image_path = $2, page_seo = $3 where tenant_id = $1`,
      [TENANT_A, A3.display, JSON.stringify({ home: { image: A1.display }, about: { title: 'About' } })])
    await owner.query(`update site_draft set pages = $2, page_seo = $3 where tenant_id = $1`,
      [TENANT_A, JSON.stringify({ home: [{ id: 's', type: 'contact', settings: { image_path: A2.display, bg_image: A1.small } }] }),
       JSON.stringify({ contact: { image: A3.display } })])
    // Site B holds usages too, which a rebuild of A must not touch.
    await owner.query(`insert into page_sections (tenant_id, page, type, position, settings) values ($1, 'home', 'intro', 0, $2)`,
      [TENANT_B, { image_path: B1.display }])
    await syncLivePage(TENANT_B, 'home', deps())
    const bBefore = await logical(TENANT_B)

    const first = await rebuildUsages(TENANT_A, deps())
    is('rebuild: every parent synced, none failed', first.failed, 0)
    const R1 = await logical(TENANT_A)
    const kinds = [...new Set(R1.map((r) => r.split('|')[1]))].sort()
    is('rebuild: all EIGHT kinds are present', kinds, [...USAGE_KINDS].sort())
    ok('rebuild: both scopes are present', R1.some((r) => r.startsWith('draft|')) && R1.some((r) => r.startsWith('live|')))

    await owner.query(`delete from photo_usages where tenant_id = $1`, [TENANT_A])
    const second = await rebuildUsages(TENANT_A, deps())
    const R2 = await logical(TENANT_A)
    is('THE INVARIANT: delete every usage, rebuild, and the projection comes back identical', R2, R1)
    is('…row for row', R2.length, R1.length)
    is('…with the same counts reported', [second.written, second.unresolved], [first.written, first.unresolved])
    is('…and the other site is untouched', await logical(TENANT_B), bBefore)
    const third = await rebuildUsages(TENANT_A, deps())
    is('rebuild over a complete projection changes nothing', [await logical(TENANT_A), third.failed], [R1, 0])

    // The rebuilt site holds the sample gallery (3 sample photographs, one the
    // chosen cover) and the sample story (featured image). Unmask exactly
    // those five sources and the count rises by exactly five; mask them again
    // and the rebuild is back to R1 — they were silently ignored.
    await owner.query(`update photos set storage_path = 'photos/unmasked/' || id where id = any ($1::uuid[])`, [sampleIds])
    await owner.query(`update blog_posts set featured_custom_path = 'journal/unmasked.jpg' where id = $1`, [sampleStory])
    const unmasked = await rebuildUsages(TENANT_A, deps())
    is('rebuild: the five sample sources, unmasked, are five more unresolved', unmasked.unresolved - first.unresolved, 5)
    for (const [i, id] of sampleIds.entries()) await owner.query(`update photos set storage_path = $2 where id = $1`, [id, SAMPLES[i]])
    await owner.query(`update blog_posts set featured_custom_path = $2 where id = $1`, [sampleStory, SAMPLES[1]])
    const remasked = await rebuildUsages(TENANT_A, deps())
    is('rebuild: as samples they are silently ignored — the same projection and counts as R1',
      [await logical(TENANT_A), remasked.unresolved, remasked.failed], [R1, first.unresolved, 0])

    // The rebuild command, on its real path: the existing rebuildUsages, as
    // the service, one site — after every usage of that site is deleted.
    await owner.query(`delete from photo_usages where tenant_id = $1`, [TENANT_A])
    const cliLines: string[] = []
    const cliCode = await runRebuild({ mode: 'tenant', tenant: TENANT_A }, {
      rebuild: (t) => rebuildUsages(t, deps()),
      listTenants: async () => (await owner.query(`select id from tenants order by id`)).rows.map((r) => r.id as string),
      out: (l) => void cliLines.push(l),
    })
    is('CLI on the real projector: exit 0, and the site\'s projection is back, identical', [cliCode, await logical(TENANT_A)], [0, R1])
    is('CLI on the real projector: its report line', cliLines,
      [`tenant ${TENANT_A}  parents ${first.parents}  failed 0  written ${first.written}  unresolved ${first.unresolved}`])
    is('…and the other site was not touched', await logical(TENANT_B), bBefore)

    // Never both, on the rebuilt live pages.
    is('rebuild: no live page holds both page_section and page_legacy',
      (await owner.query(`select page_key from photo_usages where tenant_id = $1 and scope = 'live' and kind = 'page_section'
                          intersect select page_key from photo_usages where tenant_id = $1 and scope = 'live' and kind = 'page_legacy'`, [TENANT_A])).rowCount, 0)

    // ── 4. THE P2 WRAPPERS: P2's body plus the lock, and nothing else ───────
    const p2File = read('db/migrations/2026-09-30_photo_ingest.sql')
    const ANCHOR = `  if not exists (select 1 from public.albums al where al.id = p_album and al.tenant_id = p_tenant) then
    raise exception 'There is no such gallery on this site.' using errcode = '42501';
  end if;
`
    const LOCK = `  -- P3: the album's projection lock, shared with sync_photo_usages, so an
  -- album projection and this registration never interleave.
  perform public.photo_usage_lock(p_tenant, 'album', p_album::text);
`
    const bodyIn = (text: string, name: string) => {
      const start = text.indexOf(`create or replace function public.${name}(`)
      // P2 writes `as $$` on a line of its own; prosrc is what lies between
      // the two dollar quotes.
      const open = text.indexOf('\nas $$', start) + '\nas $$'.length
      const close = text.indexOf('end $$;', open) + 'end '.length
      return text.slice(open, close)
    }
    const live = async (name: string) =>
      ((await owner.query(`select prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = $1`, [name])).rows[0]?.prosrc as string ?? '').replace(/\r\n/g, '\n')
    for (const name of ['register_gallery_photo', 'register_album_cover']) {
      const p2 = bodyIn(p2File, name)
      const expected = p2.replace(ANCHOR, () => ANCHOR + LOCK)
      is(`${name}: the live body is P2's body with ONLY the three lock lines added`, (await live(name)) === expected, true)
      is(`${name}: …and it is not P2's body unchanged`, (await live(name)) === p2, false)
    }
    for (const name of ['register_site_image', 'register_journal_image', 'upsert_photo_asset']) {
      is(`${name}: untouched by P3 — exactly P2's body`, (await live(name)) === bodyIn(p2File, name), true)
    }

    // ── 5. CONCURRENCY: the album lock, two connections ─────────────────────
    const c1 = new Client(PG)
    const c2 = new Client(PG)
    await c1.connect()
    await c2.connect()
    const pid = (c: Client) => (c as unknown as { processID: number }).processID
    const waitsOnAdvisory = async (c: Client) => {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 40))
        const w = await owner.query(`select count(*)::int n from pg_stat_activity where pid = $1 and wait_event_type = 'Lock' and wait_event = 'advisory'`, [pid(c)])
        if (w.rows[0].n === 1) return true
      }
      return false
    }
    // The canonical projection of the album: what a fresh sync writes.
    const canonical = async () => {
      const before = await logical(TENANT_A)
      await syncAlbum(TENANT_A, ALBUM_A, deps())
      return { before, after: await logical(TENANT_A) }
    }
    const galleryRowFor = async (base: string) =>
      (await owner.query(`select count(*)::int n from photo_usages u join photos p on p.id = u.photo_id
                           join photo_assets a on a.id = u.asset_id where u.kind = 'gallery' and a.key_base = $1`, [base])).rows[0].n

    try {
      // A1: an upload is mid-transaction; the album sync must wait for it.
      {
        const base = kb(TENANT_A, randomUUID(), `photos/${ALBUM_A}`)
        const held = await asPhotographer(c1, 'register_gallery_photo', galleryArgs(base), true)
        ok('A1 (gallery upload first): the registration holds its transaction open', held.error === null, held.error ?? '')
        const syncP = albumSyncHeld(c2, ALBUM_A, false)
        ok('A1: the album sync WAITS for the upload (the shared lock)', await waitsOnAdvisory(c2))
        await held.commit()
        const s = await syncP
        // The album's snapshot names its photographs, so the upload that just
        // committed has overtaken the snapshot this sync read: it is refused
        // as stale, and the real syncAlbum (which re-reads) converges.
        ok('A1: the overtaken sync then answers STALE and writes nothing', s.reply?.stale === true, JSON.stringify(s))
        const retried = await syncAlbum(TENANT_A, ALBUM_A, deps())
        ok('A1: …and the real syncAlbum, re-reading, converges', retried.ok && retried.attempts === 1, JSON.stringify(retried))
        is('A1: the new photograph has its gallery usage, once', await galleryRowFor(base), 1)
        const c = await canonical()
        is('A1: and the album projection is the canonical one', c.before, c.after)
      }
      // A2: the album sync is mid-transaction; the upload must wait for it.
      {
        const base = kb(TENANT_A, randomUUID(), `photos/${ALBUM_A}`)
        const s = await albumSyncHeld(c1, ALBUM_A, true)
        ok('A2 (sync first): the album sync holds its transaction open', s.reply?.stale === false, JSON.stringify(s))
        const regP = asPhotographer(c2, 'register_gallery_photo', galleryArgs(base))
        ok('A2: the upload WAITS for the album sync', await waitsOnAdvisory(c2))
        await s.commit()
        const r = await regP
        is('A2: the upload then succeeds', r.error, null)
        is('A2: its gallery usage is there, once (P2 wrote it; nothing lost it)', await galleryRowFor(base), 1)
        const c = await canonical()
        is('A2: and the album projection is the canonical one', c.before, c.after)
      }
      // B1: a custom cover is mid-transaction; the album sync must wait and see it.
      {
        const base = kb(TENANT_A, randomUUID(), `covers/${ALBUM_A}`)
        const held = await asPhotographer(c1, 'register_album_cover', coverArgs(base), true)
        ok('B1 (cover first): the cover registration holds its transaction open', held.error === null, held.error ?? '')
        const syncP = albumSyncHeld(c2, ALBUM_A, false)
        ok('B1: the album sync WAITS for the cover', await waitsOnAdvisory(c2))
        await held.commit()
        await syncP
        is('B1: the sync saw the NEW cover — its usage is the new cover\'s',
          (await owner.query(`select a.key_base from photo_usages u join photo_assets a on a.id = u.asset_id
                               where u.album_id = $1 and u.field = 'cover_custom_path'`, [ALBUM_A])).rows[0]?.key_base, base)
        const c = await canonical()
        is('B1: and the album projection is the canonical one', c.before, c.after)
      }
      // B2: the album sync is mid-transaction; the cover waits, then the
      // upload's own syncAlbum (uploadCustomCover's hook) brings it current.
      {
        const base = kb(TENANT_A, randomUUID(), `covers/${ALBUM_A}`)
        const s = await albumSyncHeld(c1, ALBUM_A, true)
        const regP = asPhotographer(c2, 'register_album_cover', coverArgs(base))
        ok('B2 (sync first): the cover registration WAITS for the album sync', await waitsOnAdvisory(c2))
        await s.commit()
        is('B2: the cover then registers', (await regP).error, null)
        const coverOf = async () =>
          (await owner.query(`select a.key_base from photo_usages u join photo_assets a on a.id = u.asset_id
                               where u.album_id = $1 and u.field = 'cover_custom_path'`, [ALBUM_A])).rows[0]?.key_base
        ok('B2: before the upload\'s own sync, the projection still names the previous cover', (await coverOf()) !== base)
        await syncAlbum(TENANT_A, ALBUM_A, deps()) // uploadCustomCover's hook, after its commit
        is('B2: after it, the new cover — nothing lost', await coverOf(), base)
        const c = await canonical()
        is('B2: and the album projection is the canonical one', c.before, c.after)
      }
    } finally {
      await c1.end()
      await c2.end()
    }
  } finally {
    await reset()
    await svc.end()
    await owner.end()
  }
}

function galleryArgs(base: string): Record<string, unknown> {
  return {
    p_tenant: TENANT_A, p_album: ALBUM_A, p_key_base: base, p_original_path: `${base}/original.jpg`,
    p_display_path: `${base}/1600.webp`, p_derivatives: { '400': `${base}/400.webp`, '1600': `${base}/1600.webp` },
    p_width: 1600, p_height: 1067, p_original_bytes: 4096, p_content_sha256: 'ab'.repeat(32), p_content_type: 'image/jpeg',
    p_taken_at: null, p_camera_make: null, p_camera_model: null, p_lens: null, p_iso: null, p_aperture: null,
    p_shutter: null, p_focal_length: null, p_keywords: null, p_exif: {}, p_latitude: null, p_longitude: null,
  }
}

function coverArgs(base: string): Record<string, unknown> {
  return {
    p_tenant: TENANT_A, p_album: ALBUM_A, p_key_base: base,
    p_display_path: `${base}/800.webp`, p_derivatives: { '400': `${base}/400.webp`, '800': `${base}/800.webp` },
    p_width: 800, p_height: 533, p_original_bytes: 2048, p_content_sha256: 'cd'.repeat(32), p_content_type: 'image/jpeg',
    p_filename: 'cover.jpg', p_taken_at: null, p_camera_make: null, p_camera_model: null, p_lens: null, p_iso: null,
    p_aperture: null, p_shutter: null, p_focal_length: null, p_keywords: null, p_exif: {},
  }
}

cli()
  .then(database)
  .catch((e) => fail.push(`the database half threw: ${e instanceof Error ? e.stack : String(e)}`))
  .finally(() => {
    if (fail.length) console.log('\nFAILED:\n  ' + fail.join('\n  '))
    console.log(`\n${pass + fail.length} assertions\n\n${pass} passed, ${fail.length} failed`)
    process.exit(fail.length ? 1 : 0)
  })
