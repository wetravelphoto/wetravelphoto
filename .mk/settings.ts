import { readFileSync } from 'node:fs'
import {
  SETTINGS_SECTIONS,
  searchSections,
  sectionFor,
  type SettingsSection,
} from '../lib/admin/settings-sections'

/**
 * SETTINGS, CHECKED WITHOUT A BROWSER
 * ═══════════════════════════════════
 *
 * Settings is now a list of twelve sections beside the panels of one. That
 * arrangement has one failure mode that is invisible in the code and obvious on
 * the screen: a section in the LIST with no panels in the PAGE. You click it and
 * get a heading over nothing.
 *
 * It is the same shape as every expensive bug in this project so far — a font
 * picker that never fetched, `--txt-*` variables nothing resolved, `live` fields
 * no element carried, a `.cv-sr` class defined in a stylesheet the admin does
 * not load, a class name an extension hides. A DECLARATION WITH NOTHING BEHIND
 * IT. So the two halves are checked against each other here, along with the
 * three other things that can be declared and not exist on this screen:
 *
 *   · a section id with no branch in the page, and a branch with no section;
 *   · an icon name the icon set does not draw;
 *   · a class name no stylesheet the admin loads defines;
 *   · a custom property no stylesheet the admin loads sets.
 *
 * None of these needs a browser to find, and none of them can be found by
 * reading the files, because the two sides of each pair are in different files.
 */

const ROOT = '/home/claude/build'

let pass = 0
const fail: string[] = []
const ok = (n: string, good: boolean, d = '') =>
  good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`)
const is = (n: string, got: unknown, want: unknown) =>
  ok(n, got === want, got === want ? '' : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const page = readFileSync(`${ROOT}/app/admin/settings/page.tsx`, 'utf8')
const nav = readFileSync(`${ROOT}/components/admin/SettingsNav.tsx`, 'utf8')
const rail = readFileSync(`${ROOT}/components/admin/SettingsRail.tsx`, 'utf8')
const layout = readFileSync(`${ROOT}/app/admin/layout.tsx`, 'utf8')
const sheet = readFileSync(`${ROOT}/app/admin/settings-screen.css`, 'utf8')
const icons = readFileSync(`${ROOT}/components/admin/Icon.tsx`, 'utf8')

// ── The list itself ──────────────────────────────────────────────────────────

is('there are twelve sections', SETTINGS_SECTIONS.length, 12)

const ids = SETTINGS_SECTIONS.map((s) => s.id)
is('every id is unique', new Set(ids).size, ids.length)

for (const s of SETTINGS_SECTIONS) {
  ok(`${s.id} has a blurb`, s.blurb.length > 20, s.blurb)
  ok(`${s.id} ends its blurb with a full stop`, /[.?]$/.test(s.blurb), s.blurb)
  ok(`${s.id} carries search words`, s.finds.length >= 4, `${s.finds.length} words`)
  /*
   * The query is lowercased before it is matched, so an upper-case letter in a
   * `finds` entry is a word that can never be found. Nothing about reading the
   * list would tell you that.
   */
  for (const f of s.finds) {
    ok(`"${f}" is lowercase, so the search can match it`, f === f.toLowerCase())
  }
  ok(`${s.id} is not named after its own id`, s.label !== s.id)
}

// ── Which section an address opens ───────────────────────────────────────────

is('no ?s= at all opens General', sectionFor(undefined).id, 'general')
is('an unknown ?s= opens General', sectionFor('nonsense').id, 'general')
is('a repeated ?s= takes the first', sectionFor(['contact', 'team']).id, 'contact')

for (const s of SETTINGS_SECTIONS) {
  if (s.soon) {
    /* Typing the id of something that does not exist must not open an empty
       screen either — the guard belongs in one place, not on the links. */
    is(`?s=${s.id} cannot be opened by hand`, sectionFor(s.id).id, 'general')
  } else {
    is(`?s=${s.id} opens ${s.label}`, sectionFor(s.id).id, s.id)
  }
}

// ── The search ───────────────────────────────────────────────────────────────

is('an empty search lists everything', searchSections('').length, SETTINGS_SECTIONS.length)
is('an empty search reports no match on any of them', searchSections('  ').filter((r) => r.hit).length, 0)

/** The words somebody actually types, and where each one has to land. */
const LOOKS_FOR: [string, string][] = [
  ['favicon', 'general'],
  ['site icon', 'general'],
  ['owner', 'general'],
  ['copyright', 'general'],
  ['tagline', 'contact'],
  ['facebook', 'contact'],
  ['notify', 'email'],
  ['contact form', 'email'],
  ['menu', 'menu'],
  ['prints', 'menu'],
  ['dns', 'domains'],
  ['google', 'seo'],
  ['open graph', 'seo'],
  ['instagram feed', 'integrations'],
  ['token', 'integrations'],
  ['subscribers', 'newsletter'],
  ['mailchimp', 'newsletter'],
  ['permissions', 'team'],
  ['invite', 'team'],
  ['timezone', 'locale'],
  ['cookies', 'privacy'],
  ['backfill', 'advanced'],
  ['thumbnails', 'advanced'],
]

for (const [typed, want] of LOOKS_FOR) {
  const found = searchSections(typed).map((r) => r.section.id)
  ok(`"${typed}" finds ${want}`, found.includes(want), `found ${JSON.stringify(found)}`)
}

/* Case and stray spaces are what a search box actually receives. */
is('"FAVICON" finds General too', searchSections('FAVICON')[0]?.section.id, 'general')
is('"  favicon " is trimmed', searchSections('  favicon ')[0]?.section.id, 'general')
is('a word in nothing finds nothing', searchSections('xyzzy').length, 0)

/* When the name matched, there is nothing to explain. */
const byName = searchSections('newsletter').find((r) => r.section.id === 'newsletter')
is('matching the name reports no hit line', byName?.hit, null)
const byWord = searchSections('mailchimp').find((r) => r.section.id === 'newsletter')
is('matching a setting reports which one', byWord?.hit, 'mailchimp')

// ── THE PAIR: a section in the list, and panels in the page ─────────────────

/** Every `section.id === 'x'` the page branches on. */
const branches = new Set([...page.matchAll(/section\.id === '([a-z-]+)'/g)].map((m) => m[1]))

ok('the page branches on section ids at all', branches.size > 5, `${branches.size} branches`)

for (const s of SETTINGS_SECTIONS) {
  if (s.soon) {
    ok(
      `${s.id} has no panels, and is marked Soon rather than drawn`,
      !branches.has(s.id),
      'it is in the list as `soon` and the page also renders panels for it — one of the two is wrong'
    )
  } else {
    ok(
      `${s.id} has panels in the page`,
      branches.has(s.id),
      `“${s.label}” is clickable in the section list and app/admin/settings/page.tsx renders nothing for it. ` +
        'Clicking it gives a heading over an empty column. Either add its panels or mark it `soon`.'
    )
  }
}

for (const id of branches) {
  ok(
    `the page's "${id}" branch is a section somebody can reach`,
    ids.includes(id),
    'the page renders panels for a section id that is not in SETTINGS_SECTIONS, so nothing can open it'
  )
}

// ── THE PAIR: an icon name, and an icon ─────────────────────────────────────

/** The names Icon.tsx actually draws, read from its PATHS map. */
const drawn = new Set(
  [...icons.matchAll(/^ {2}'?([a-z-]+)'?: (?:\(|<|\s*$)/gm)].map((m) => m[1])
)

ok('the icon set was parsed', drawn.size > 25, `${drawn.size} icons found`)

for (const s of SETTINGS_SECTIONS) {
  ok(
    `${s.id}'s icon "${s.icon}" is one the set draws`,
    drawn.has(s.icon),
    'an icon name with no path behind it renders an empty 24px box'
  )
}

for (const file of [
  ['SettingsNav.tsx', nav],
  ['SettingsRail.tsx', rail],
  ['settings/page.tsx', page],
] as const) {
  // `<Icon name="…">` and not `<input name="tagline">`, which the first cut of
  // this matched — and then reported a missing icon called "tagline".
  for (const m of file[1].matchAll(/<Icon[^>]*\bname="([a-z-]+)"/g)) {
    ok(`${file[0]}: icon "${m[1]}" exists`, drawn.has(m[1]))
  }
}

// ── THE PAIR: a class name, and a rule ──────────────────────────────────────

/**
 * Every stylesheet the admin loads, in the order it loads them — read from the
 * layout's own imports, so adding a sheet does not mean remembering this file.
 */
const IMPORTED = [...layout.matchAll(/^import '(\.[^']+\.css)'/gm)].map((m) =>
  m[1].replace(/^\.\.\//, '').replace(/^\.\//, 'app/admin/')
)

ok('the layout imports stylesheets', IMPORTED.length > 10, `${IMPORTED.length} sheets`)
ok(
  'settings-screen.css is one of them',
  IMPORTED.some((f) => f.endsWith('settings-screen.css')),
  'the sheet exists and nothing loads it, so the screen draws unstyled — which is exactly ' +
    'how `.cv-sr` came to be drawn on the page'
)

const ALL_CSS = IMPORTED.map((f) => {
  try {
    return readFileSync(`${ROOT}/${f.startsWith('app/') ? f : `app/${f}`}`, 'utf8')
  } catch {
    return ''
  }
}).join('\n')

ok('and they could be read', ALL_CSS.length > 40_000, `${ALL_CSS.length} bytes`)

/** Class names used in the three files of this screen. */
const used = new Map<string, string>()
for (const [name, src] of [
  ['SettingsNav.tsx', nav],
  ['SettingsRail.tsx', rail],
  ['settings/page.tsx', page],
] as const) {
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const cls of (m[1] ?? m[2] ?? '').split(/[\s${}?:'"]+/)) {
      if (/^[a-z][a-z0-9-]*$/.test(cls) && !used.has(cls)) used.set(cls, name)
    }
  }
}

ok('class names were found in them', used.size > 25, `${used.size} names`)

for (const [cls, where] of used) {
  ok(
    `.${cls} is defined in a stylesheet the admin loads`,
    new RegExp(`\\.${cls}(?![a-z0-9-])`).test(ALL_CSS),
    `used in ${where} — no rule for it in any of the ${IMPORTED.length} sheets app/admin/layout.tsx imports. ` +
      'A class with no rule behind it is not a styling mistake, it is a missing element: ' +
      'see the `.cv-sr` note in workspace.css.'
  )
}

/* And the other way: a rule for something nothing draws is a rule nobody can
   fix, because there is nothing on screen to point at. */
const defined = new Set([...sheet.matchAll(/\.(st-[a-z0-9-]+)/g)].map((m) => m[1]))
ok('the sheet defines st- classes', defined.size > 20, `${defined.size} rules`)

for (const cls of defined) {
  ok(
    `.${cls} is used by something`,
    used.has(cls),
    'settings-screen.css styles it and no component draws it'
  )
}

// ── THE PAIR: a custom property, and a value ────────────────────────────────

/*
 * `var(--lg-top-h)` in one sheet and `--lg-top-h:` in another is the whole
 * mechanism of the sticky columns on this screen. An unset property makes the
 * `calc()` around it invalid, the `top` is dropped, and the section list simply
 * scrolls away — which looks like a design decision rather than a bug.
 */
for (const m of sheet.matchAll(/var\((--[a-z0-9-]+)/g)) {
  ok(
    `${m[1]} is set somewhere the admin loads`,
    new RegExp(`${m[1]}\\s*:`).test(ALL_CSS),
    'settings-screen.css reads a custom property nothing defines; every declaration using it is ' +
      'discarded at parse time, silently'
  )
}

ok(
  '--lg-top-h is what the top bar is actually sized by',
  /min-height: var\(--lg-top-h\)/.test(ALL_CSS),
  'the sticky offsets clear a height the bar does not use, so the two can drift apart'
)

// ── THE PAIR: a frame's ratio, and the page drawn in it ────────────────────

/*
 * PageThumb renders the page at SHOT_WIDTH × SHOT_HEIGHT and scales it by WIDTH.
 * So a frame taller than SHOT_HEIGHT / SHOT_WIDTH is taller than the thing
 * inside it, and the difference is a band of the frame's own background under
 * the page — which reads as the site having a white strip at the bottom rather
 * than as a box being the wrong shape. Shorter is fine; it crops.
 */
const TALLEST = 800 / 1280

for (const [name, src] of [
  ['SettingsRail.tsx', rail],
  ['Overview.tsx', readFileSync(`${ROOT}/components/admin/Overview.tsx`, 'utf8')],
  ['PageCard.tsx', readFileSync(`${ROOT}/components/admin/PageCard.tsx`, 'utf8')],
] as const) {
  for (const m of src.matchAll(/ratio="(\d+)\s*\/\s*(\d+)"/g)) {
    const tall = Number(m[2]) / Number(m[1])
    ok(
      `${name}: a ${m[1]}/${m[2]} frame has no band under the page`,
      tall <= TALLEST + 0.001,
      `${m[1]}/${m[2]} is ${tall.toFixed(3)} tall; the miniature is ${TALLEST} — the ` +
        `difference is drawn as the frame's background`
    )
  }
}

// ── The layout the brief asked for ──────────────────────────────────────────

is(
  'three columns: sections, panels, preview',
  /grid-template-areas:\s*'nav body rail'/.test(sheet),
  true
)
ok(
  'the preview drops under the panels before the section list does',
  sheet.indexOf("'nav body'\n      'nav rail'") > 0 ||
    /grid-template-areas:\s*\n?\s*'nav body'\s*\n\s*'nav rail'/.test(sheet),
  'at the first breakpoint the list must stay beside the panels — it is how you get anywhere'
)
ok(
  'and both give way on a phone',
  /grid-template-areas: 'nav' 'body' 'rail'/.test(sheet)
)

// ── What the page must not have grown back ──────────────────────────────────

ok(
  'no single Save over five independent actions',
  !/Save all|Save everything|Save changes/.test(page),
  'each panel writes through its own server action; one button over the lot of them has nothing ' +
    'honest to say when the third of five fails'
)

ok(
  'the heavy queries are asked for by the section that draws them',
  /section\.id === 'newsletter' &&/.test(page) && /section\.id === 'integrations'/.test(page),
  'every section paid for six counted queries and two secret lookups before this'
)

ok(
  'the team list is still scoped to this site',
  /from\('profiles'\)[\s\S]{0,200}?\.eq\('tenant_id', tenantId\)/.test(page),
  'unscoped, a platform admin opening Settings sees every tester on the platform'
)

ok(
  'the Instagram token is never sent back to the page',
  !/instagram_token['"]?\s*[:=]\s*settings/.test(page) && /type="password"/.test(page),
  'the field is write-only; only whether one is saved comes back'
)

console.log(`${pass + fail.length} assertions`)
for (const f of fail) console.log('FAIL ' + f)
console.log(`\n${pass} passed, ${fail.length} failed`)
process.exit(fail.length ? 1 : 0)

// Keeps the type import honest if the list is ever narrowed.
export type { SettingsSection }
