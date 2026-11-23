/**
 * The legacy cover's title colour — RENDERED through the real CoverRenderer.
 *
 *   node node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs .mk/cover-renderer-color.ts
 *
 * The light layouts (text on the cream panel) must draw the colour the
 * photographer chose, light ones included, so the live preview follows the
 * control. The single exception is the stored default, '#FAF9F6'
 * (`albums.cover_title_color` is NOT NULL DEFAULT '#FAF9F6', and the save
 * action writes it for a blank field): it keeps the dark ink an unedited album
 * always had. Choosing exactly that swatch on a light layout is
 * indistinguishable from never choosing, and also draws dark ink — asserted
 * here so the tradeoff is visible rather than accidental.
 *
 * The dark (photo-filled) layouts draw the chosen colour as they always did.
 * Synthetic settings; no network, no database.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CoverRenderer, { type CoverSettings, isLegacyDefaultColor } from '@/components/CoverRenderer'
import { COVER_LAYOUTS } from '@/lib/cover-layouts'

let pass = 0
const fail: string[] = []
function ok(name: string, good: boolean, detail?: unknown) {
  if (good) pass++
  else fail.push(`${name}${detail === undefined ? '' : ` — got ${JSON.stringify(detail)}`}`)
}

const base: CoverSettings = {
  title: 'Synthetic Title',
  subtitle: 'Synthetic subtitle',
  location: 'Somewhere',
  showLocation: true,
  layout: null,
  font: null,
  titleScale: 1,
  color: null,
  focalX: 0.5,
  focalY: 0.5,
  overlayType: 'none',
  overlayOpacity: 0.3,
  imageUrl: 'https://example.invalid/cover.jpg',
}

function render(layout: string | null, color: string | null) {
  const html = renderToStaticMarkup(createElement(CoverRenderer, { settings: { ...base, layout, color } }))
  const styleOf = (tag: string) => /style="([^"]*)"/.exec(new RegExp(`<${tag}[^>]*>`).exec(html)?.[0] ?? '')?.[1] ?? ''
  const colorIn = (style: string) => /(?:^|;)color:([^;]+)/.exec(style)?.[1] ?? null
  const ps = [...html.matchAll(/<p style="([^"]*)"/g)].map((m) => colorIn(m[1]!))
  return { html, title: colorIn(styleOf('h1')), soft: ps }
}

const light = COVER_LAYOUTS.filter((l) => l.lightText).map((l) => l.value)
const dark = COVER_LAYOUTS.filter((l) => !l.lightText).map((l) => l.value)
ok('there are light layouts to test', light.length === 6, light)
ok('there are dark layouts to test', dark.length > 0, dark)

// ---- light layouts: an explicit colour is drawn exactly, light ones included
for (const layout of light) {
  for (const c of ['#FFFFFF', '#F2EEE7', '#FFE600', '#123456', '#B23A2F']) {
    const r = render(layout, c)
    ok(`${layout}: title draws the chosen ${c}`, r.title === c, r.title)
    ok(`${layout}: meta and subtitle draw the chosen ${c}`, r.soft.length === 2 && r.soft.every((s) => s === c), r.soft)
  }
}

// ---- light layouts: the stored default (and no value) keeps the legacy dark ink
for (const layout of light) {
  for (const c of [null, '', '#FAF9F6', '#faf9f6', ' #FAF9F6 ']) {
    const r = render(layout, c)
    ok(`${layout}: default ${JSON.stringify(c)} keeps dark ink on the title`, r.title === '#14100E', r.title)
    ok(`${layout}: default ${JSON.stringify(c)} keeps soft dark ink`, r.soft.every((s) => s === 'rgba(20,16,14,0.6)'), r.soft)
  }
}

// ---- decorations follow the chosen colour too (Editorial's rules, Divider's underline)
{
  const rules = render('wide_card', '#FFFFFF').html
  ok('wide_card: the rules are drawn in the chosen white', /height:1px;width:100%;background:#FFFFFF/.test(rules))
  const under = render('divider', '#FFFFFF').html
  ok('divider: the underline is drawn in the chosen white', /height:2px;background:#FFFFFF/.test(under))
  const def = render('wide_card', null).html
  ok('wide_card: unedited rules stay dark ink', /height:1px;width:100%;background:#14100E/.test(def))
}

// ---- the light layouts' button is unchanged (dark plate, cream label)
{
  const html = renderToStaticMarkup(createElement(CoverRenderer, { settings: { ...base, layout: 'novel', color: '#FFFFFF', showButton: true } }))
  ok('novel: the button keeps its dark plate and cream label', /<button[^>]*background:#14100E;color:#FAF9F6/.test(html))
}

// ---- dark layouts: unchanged — the chosen colour, the default cream when unset
for (const layout of dark) {
  ok(`${layout}: unset draws the cream default`, render(layout, null).title === '#FAF9F6', render(layout, null).title)
  ok(`${layout}: the stored default draws cream`, render(layout, '#FAF9F6').title === '#FAF9F6')
  ok(`${layout}: an explicit white draws white`, render(layout, '#FFFFFF').title === '#FFFFFF')
  ok(`${layout}: an explicit dark draws dark`, render(layout, '#123456').title === '#123456')
}

// ---- the predicate itself
ok('isLegacyDefaultColor: the default, any case and padding', ['#FAF9F6', '#faf9f6', ' #FaF9f6 '].every(isLegacyDefaultColor))
ok('isLegacyDefaultColor: nothing else', !['#FFFFFF', '#F2EEE7', '#FAF9F7', 'FAF9F6', ''].some(isLegacyDefaultColor))

console.log(`cover-renderer-color: ${pass} passed, ${fail.length} failed`)
for (const f of fail) console.log(`  FAIL ${f}`)
process.exit(fail.length ? 1 : 0)
