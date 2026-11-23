import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

/**
 * GALLERY SMALL-COUNT RULES — lib/gallery/layouts.ts, pure, no DOM.
 *
 *   node node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs .mk/gallery-small-count.ts [--mutations]
 *
 * The rule (.ai-handoff/client-gallery-v2-prompt.md, Part 2):
 *   1 photo   → large and centred
 *   2–4       → one or two justified rows — for EVERY layout, not only
 *               masonry and grid
 * and from 5 photographs every layout keeps the behaviour it had before.
 *
 * "Before" is a frozen copy of the pre-correction arrangementFor and
 * justifiedRows, below; every count ≥ 5 (and every 2–4 case that was already
 * one or two rows) must match it exactly.
 *
 * --mutations writes mutated copies of layouts.ts under .ai-handoff/ (never
 * the real file), re-runs the suite against each, and requires the NAMED check
 * to fail. The real file's bytes are compared before and after.
 */

const ROOT = resolve(__dirname, '..')
const SRC = join(ROOT, 'lib/gallery/layouts.ts')

type Placed = { index: number; width: number; height: number }
type Row = { items: Placed[]; height: number; filled: boolean }
type Lay = {
  arrangementFor(style: string, count: number): string
  justifiedRows(ratios: readonly number[], width: number, gap: number, target?: number, maxHeight?: number): Row[]
  targetRowHeight(width: number): number
  LAYOUT_STYLES: ReadonlyArray<{ key: string }>
}

// ── the frozen pre-correction behaviour ────────────────────────────────────

function oldArrangementFor(style: string, count: number): string {
  if (count <= 0) return 'none'
  if (count === 1) return 'single'
  if (style === 'single_column') return 'column'
  if (style === 'square') return 'square'
  if (count <= 4) return 'justified'
  if (style === 'masonry') return count >= 6 ? 'masonry' : 'justified'
  if (style === 'editorial') return 'editorial'
  return 'justified'
}

function oldTarget(width: number): number {
  if (width < 520) return Math.max(150, width * 0.62)
  if (width < 900) return width * 0.36
  return Math.min(380, Math.max(240, width * 0.24))
}

function oldPlace(ratios: readonly number[], from: number, to: number, h: number): Placed[] {
  const out: Placed[] = []
  for (let i = from; i <= to; i++) out.push({ index: i, width: ratios[i]! * h, height: h })
  return out
}

function oldJustifiedRows(ratios: readonly number[], width: number, gap: number, target = oldTarget(width), maxHeight = target * 1.6): Row[] {
  const rows: Row[] = []
  let start = 0
  while (start < ratios.length) {
    let end = start
    let sum = 0
    let chosen = -1
    for (let i = start; i < ratios.length; i++) {
      const nextSum = sum + ratios[i]!
      const h = (width - gap * (i - start)) / nextSum
      if (h <= target) {
        const without = i > start ? (width - gap * (i - 1 - start)) / sum : Infinity
        chosen = Math.abs(without - target) < Math.abs(h - target) && i > start ? i - 1 : i
        break
      }
      sum = nextSum
      end = i
    }
    if (chosen === -1) {
      const n = ratios.length - start
      const total = ratios.slice(start).reduce((a, b) => a + b, 0)
      const natural = (width - gap * (n - 1)) / total
      const filled = natural <= maxHeight
      const h = filled ? natural : Math.min(target, maxHeight)
      rows.push({ items: oldPlace(ratios, start, ratios.length - 1, h), height: h, filled })
      break
    }
    end = chosen
    const total = ratios.slice(start, end + 1).reduce((a, b) => a + b, 0)
    const natural = (width - gap * (end - start)) / total
    const h = Math.min(maxHeight, natural)
    rows.push({ items: oldPlace(ratios, start, end, h), height: h, filled: h === natural })
    start = end + 1
  }
  return rows
}

// ── inputs ──────────────────────────────────────────────────────────────────

const STYLES = ['grid', 'masonry', 'single_column', 'square', 'editorial'] as const
const WIDTHS = [200, 320, 375, 390, 430, 519, 520, 768, 899, 900, 1024, 1200, 1440, 1920]
const gapFor = (w: number) => (w < 520 ? 6 : w < 900 ? 10 : 14) // as components/gallery/PhotoLayout.tsx

function ratioSets(n: number): Array<{ name: string; ratios: number[] }> {
  const fill = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i))
  let seed = 7 * n + 1
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const sets = [
    { name: 'landscape', ratios: fill(() => 1.5) },
    { name: 'portrait', ratios: fill(() => 2 / 3) },
    { name: 'square', ratios: fill(() => 1) },
    { name: 'panorama', ratios: fill(() => 4) },
    { name: 'sliver', ratios: fill(() => 0.25) },
    { name: 'mixed', ratios: fill((i) => (i % 3 === 2 ? 2 / 3 : 3 / 2)) },
    { name: 'pano-then-portraits', ratios: fill((i) => (i === 0 ? 4 : 2 / 3)) },
  ]
  for (let k = 0; k < 6; k++) sets.push({ name: `random${k}`, ratios: fill(() => Math.min(4, Math.max(0.25, 0.25 + rnd() * 3.75))) })
  return sets
}

// ── the suite, against any copy of the module ──────────────────────────────

function suite(LAY: Lay, layoutSource: string, photoLayoutSource: string): { pass: number; fail: string[] } {
  let pass = 0
  const fail: string[] = []
  const ok = (n: string, good: boolean, d = '') => (good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`))
  const is = (n: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got)
    const w = JSON.stringify(want)
    ok(n, g === w, g === w ? '' : `got ${g}\n    wanted ${w}`)
  }

  // A. arrangement, every layout × every count 0–6, spelled out.
  is('arrangement: offered layouts are exactly the five tested here', LAY.LAYOUT_STYLES.map((l) => l.key).sort(), [...STYLES].sort())
  const want: Record<string, string[]> = {
    //              0       1         2            3            4            5             6
    grid:          ['none', 'single', 'justified', 'justified', 'justified', 'justified', 'justified'],
    masonry:       ['none', 'single', 'justified', 'justified', 'justified', 'justified', 'masonry'],
    single_column: ['none', 'single', 'justified', 'justified', 'justified', 'column', 'column'],
    square:        ['none', 'single', 'justified', 'justified', 'justified', 'square', 'square'],
    editorial:     ['none', 'single', 'justified', 'justified', 'justified', 'editorial', 'editorial'],
  }
  for (const s of STYLES) is(`arrangement: ${s} at 0–6`, [0, 1, 2, 3, 4, 5, 6].map((n) => LAY.arrangementFor(s, n)), want[s])
  is('arrangement: 1 photo is single for every layout', STYLES.map((s) => LAY.arrangementFor(s, 1)), STYLES.map(() => 'single'))
  for (const n of [2, 3, 4]) is(`arrangement: ${n} photos are justified for every layout`, STYLES.map((s) => LAY.arrangementFor(s, n)), STYLES.map(() => 'justified'))
  is('arrangement: a negative count is none', LAY.arrangementFor('grid', -1), 'none')

  // B. larger counts keep their previous arrangement exactly.
  const larger: string[] = []
  for (const s of STYLES) for (let n = 5; n <= 60; n++) if (LAY.arrangementFor(s, n) !== oldArrangementFor(s, n)) larger.push(`${s}@${n}`)
  ok('arrangement: every layout at 5–60 unchanged from before', larger.length === 0, larger.slice(0, 8).join(', '))

  // C. 2–4 photographs: one or two justified rows, well formed, at every width.
  const tooMany: string[] = []
  const malformed: string[] = []
  const changedWhenFine: string[] = []
  for (const n of [2, 3, 4]) {
    for (const { name, ratios } of ratioSets(n)) {
      for (const w of WIDTHS) {
        const gap = gapFor(w)
        const rows = LAY.justifiedRows(ratios, w, gap)
        const tag = `n=${n} ${name} w=${w}`
        if (rows.length < 1 || rows.length > 2) tooMany.push(`${tag}: ${rows.length} rows`)
        const cap = LAY.targetRowHeight(w) * 1.6 + 1e-9
        const order = rows.flatMap((r) => r.items.map((i) => i.index)).join()
        const bad =
          order !== ratios.map((_, i) => i).join() ||
          rows.some((r) => !(r.height > 0) || r.height > cap) ||
          rows.some((r) => r.items.some((it) => Math.abs(it.width / it.height - ratios[it.index]!) > 1e-9 || it.height !== r.height)) ||
          rows.some((r) => {
            const used = r.items.reduce((a, b) => a + b.width, 0) + gap * (r.items.length - 1)
            return r.filled ? Math.abs(used - w) > 0.5 : used > w + 0.5
          })
        if (bad) malformed.push(tag)
        const before = oldJustifiedRows(ratios, w, gap)
        if (before.length <= 2 && JSON.stringify(before) !== JSON.stringify(rows)) changedWhenFine.push(tag)
      }
    }
  }
  ok('rows: 2–4 photos are always one or two rows', tooMany.length === 0, tooMany.slice(0, 6).join('; '))
  ok('rows: 2–4 photos — each placed once, in order; ratio kept; full rows exactly the width; none over the cap', malformed.length === 0, malformed.slice(0, 6).join('; '))
  ok('rows: 2–4 photos that already made one or two rows are laid out exactly as before', changedWhenFine.length === 0, changedWhenFine.slice(0, 6).join('; '))

  // The case that motivated the bound: four landscapes on a phone. The old
  // greedy pass makes one row each (asserted, so this check means something);
  // now two balanced rows of two, each the full width.
  const phone = [1.5, 1.5, 1.5, 1.5]
  ok('rows: precondition — before, four landscapes at 375px were four rows', oldJustifiedRows(phone, 375, 6).length === 4)
  const p = LAY.justifiedRows(phone, 375, 6)
  is('rows: four landscapes at 375px are two rows of two, both filled', p.map((r) => [r.items.length, r.filled]), [[2, true], [2, true]])
  const two = LAY.justifiedRows([1.5, 1.5], 375, 6)
  is('rows: two landscapes at 375px are one row each — a full-width pair would be a strip', two.map((r) => r.items.length), [1, 1])
  const three = LAY.justifiedRows([1.5, 1.5, 1.5], 1200, 14)
  ok('rows: three landscapes at 1200px make one or two rows', three.length >= 1 && three.length <= 2)

  // D. 1 photograph handed to the row arithmetic is untouched (single is drawn
  // separately, but the arithmetic must not change underneath it either).
  for (const w of [375, 1200]) is(`rows: one photo at ${w}px unchanged`, LAY.justifiedRows([1.5], w, gapFor(w)), oldJustifiedRows([1.5], w, gapFor(w)))
  is('rows: no photos → no rows', LAY.justifiedRows([], 1200, 14), [])

  // E. larger counts: the row arithmetic is byte-for-byte what it was.
  const drift: string[] = []
  for (let n = 5; n <= 40; n++)
    for (const { name, ratios } of ratioSets(n))
      for (const w of WIDTHS) if (JSON.stringify(LAY.justifiedRows(ratios, w, gapFor(w))) !== JSON.stringify(oldJustifiedRows(ratios, w, gapFor(w)))) drift.push(`n=${n} ${name} w=${w}`)
  ok('rows: every set of 5–40 photos at every width laid out exactly as before', drift.length === 0, drift.slice(0, 6).join('; '))
  ok('rows: precondition — some 5+ sets at phone width do exceed two rows (so E would see a leaked bound)', oldJustifiedRows([1.5, 1.5, 1.5, 1.5, 1.5], 375, 6).length > 2)

  // F. wiring: the renderer asks arrangementFor about the photographs it lays
  // out, and draws 'justified' through justifiedRows — so A and C reach the page.
  ok('wiring: PhotoLayout arranges by arrangementFor(layout, rest.length)', /arrangementFor\(layout,\s*rest\.length\)/.test(photoLayoutSource))
  ok("wiring: PhotoLayout draws 'justified' with justifiedRows", /case 'justified':\s*body = rows\(justifiedRows\(ratios, width, gap\)\)/.test(photoLayoutSource))
  ok('wiring: layouts.ts exports both', /export function arrangementFor/.test(layoutSource) && /export function justifiedRows/.test(layoutSource))

  return { pass, fail }
}

// ── mutants ─────────────────────────────────────────────────────────────────

const MUTANTS: Array<{ name: string; find: string; replace: string; expect: string }> = [
  {
    name: 'the reported bug: single_column and square checked before the small count',
    find: "  if (count <= SMALL_COUNT_MAX) return 'justified'\n  if (style === 'single_column') return 'column'\n  if (style === 'square') return 'square'\n",
    replace: "  if (style === 'single_column') return 'column'\n  if (style === 'square') return 'square'\n  if (count <= SMALL_COUNT_MAX) return 'justified'\n",
    expect: 'arrangement: single_column at 0–6',
  },
  { name: 'small count stops at 3', find: "if (count <= SMALL_COUNT_MAX) return 'justified'", replace: "if (count <= 3) return 'justified'", expect: 'arrangement: 4 photos are justified for every layout' },
  { name: 'one photo no longer single', find: "  if (count === 1) return 'single'\n", replace: '', expect: 'arrangement: 1 photo is single for every layout' },
  { name: 'masonry from 5', find: "count >= MASONRY_MIN ? 'masonry'", replace: "count >= 5 ? 'masonry'", expect: 'arrangement: masonry at 0–6' },
  { name: 'two-row bound removed', find: '|| rows.length <= 2) return rows', replace: '|| true) return rows', expect: 'rows: 2–4 photos are always one or two rows' },
  { name: 'bound leaks to larger sets', find: 'ratios.length > SMALL_COUNT_MAX || ', replace: '', expect: 'rows: every set of 5–40 photos at every width laid out exactly as before' },
  { name: 'bound applied even when the greedy rows were fine', find: ' || rows.length <= 2) return rows', replace: ') return rows', expect: 'rows: 2–4 photos that already made one or two rows are laid out exactly as before' },
  { name: 'fallback never tries a two-row split', find: 'for (let split = 0; split < last; split++)', replace: 'for (let split = 0; split < 0; split++)', expect: 'rows: four landscapes at 375px are two rows of two, both filled' },
  {
    // Summed deviation prefers 1+3 (one row near the target, one strip) over
    // two balanced rows of two; the worst row is what the eye sees.
    name: 'fallback scores by summed, not worst, deviation',
    find: 'Math.max(...rs.map((r) => Math.abs(Math.log(r.height / target))))',
    replace: 'rs.reduce((a, r) => a + Math.abs(Math.log(r.height / target)), 0)',
    expect: 'rows: four landscapes at 375px are two rows of two, both filled',
  },
]

// A synchronous require, not import(): tsx compiles these .ts files as
// CommonJS, and each mutant has its own file name, so the module cache never
// serves a stale copy.
const req = createRequire(join(ROOT, 'package.json'))
function load(path: string): Lay {
  return req(path) as Lay
}

async function main() {
  const original = readFileSync(SRC, 'utf8')
  const photoLayout = readFileSync(join(ROOT, 'components/gallery/PhotoLayout.tsx'), 'utf8')
  const real = suite(load(SRC), original, photoLayout)
  console.log(`gallery-small-count: ${real.pass} passed, ${real.fail.length} failed`)
  for (const f of real.fail) console.log(`  FAIL ${f}`)
  if (real.fail.length) process.exit(1)

  if (!process.argv.includes('--mutations')) return

  const dir = join(ROOT, '.ai-handoff', 'gallery-small-count-mutants')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  let caught = 0
  const missed: string[] = []
  // A verbatim copy first: the harness itself must pass on an unmutated copy.
  const baselinePath = join(dir, 'baseline.ts')
  writeFileSync(baselinePath, original)
  const baseline = suite(load(baselinePath), original, photoLayout)
  if (baseline.fail.length) {
    console.log('mutations: the unmutated copy does not pass — harness broken')
    process.exit(1)
  }
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  for (const [i, m] of MUTANTS.entries()) {
    const find = m.find.replace(/\n/g, eol)
    const hits = original.split(find).length - 1
    if (hits !== 1) {
      missed.push(`${m.name}: anchor found ${hits} times`)
      continue
    }
    const mutated = original.replace(find, m.replace.replace(/\n/g, eol))
    const path = join(dir, `m${i}.ts`)
    writeFileSync(path, mutated)
    const r = suite(load(path), mutated, photoLayout)
    const named = r.fail.some((f) => f.startsWith(m.expect))
    if (named) caught++
    else missed.push(`${m.name}: expected "${m.expect}" to fail; failed: ${r.fail.map((f) => f.split('\n')[0]).join(' | ') || 'nothing'}`)
    console.log(`  ${named ? 'caught' : 'MISSED'}  ${m.name}`)
  }
  rmSync(dir, { recursive: true, force: true })
  const after = readFileSync(SRC, 'utf8')
  const untouched = after === original
  console.log(`mutations: baseline ok, ${caught}/${MUTANTS.length} caught by the named check; real file ${untouched ? 'unchanged' : 'CHANGED'}`)
  for (const m of missed) console.log(`  MISSED ${m}`)
  if (missed.length || !untouched) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
