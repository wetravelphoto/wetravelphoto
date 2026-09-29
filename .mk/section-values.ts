import {
  SECTIONS,
  resolveSettings,
  type Field,
  type SectionDef,
  type SectionSettings,
} from '@/lib/sections/registry'
import { readSettingsFromForm } from '@/lib/sections/form'
import { validateValues, fieldForKey, checkValue } from '@/lib/sections/values'
import { BASE_DEVICE, DEVICES, deviceKey } from '@/lib/sections/devices'
import { readFileSync } from 'node:fs'

/**
 * WHAT THE PROGRAMMATIC WRITER WILL ACCEPT
 * ════════════════════════════════════════
 *
 * `updateDraftSectionValues` is the writer that is NOT a form: the focal-point
 * picker, the story chooser, the image pickers, the typography panel and a drag
 * in the preview all save through it, and — the reason this suite exists now —
 * it is the writer anything automated would use.
 *
 * Until this change it checked that the KEY existed and stored whatever value
 * came with it. The form path, one file away, had always checked the value
 * against its field: a colour that is not a hex refused, a `select` outside its
 * own options refused, a number clamped into its declared range. Two writers,
 * one of them checking.
 *
 * Each block below does two things, in this order:
 *
 *   1. shows that THE WRITER THIS REPLACED accepted the bad value. `wasOpen`
 *      models the old code exactly — the key-existence loop and a blind merge —
 *      so every case here is on the record as a hole that was really open, not
 *      a hypothetical one. A test that never saw the bug proves nothing.
 *   2. shows that the new one refuses it.
 *
 * And the other half, which matters more than the refusals: every value the
 * editor's own panel can produce is still accepted, unchanged. That is what
 * makes this safe to deploy. A validator that is too strict does not fail
 * loudly — Next redacts a server action's message in production, so what a
 * photographer sees is "Minified React error #441" and nothing else. It has
 * happened once already, which is why `derivedDefaults` exists.
 */

let pass = 0
const fail: string[] = []
const ok = (n: string, good: boolean, d = '') =>
  good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`)

/**
 * THE WRITER THIS REPLACED, exactly.
 *
 * `app/actions/canvas.ts` before this change: every key had to exist in the
 * section's defaults, and then the values were merged in as they arrived. Kept
 * here so each assertion below can be shown to have had something to catch.
 */
function wasOpen(def: SectionDef, values: Record<string, unknown>): SectionSettings {
  for (const key of Object.keys(values)) {
    if (!(key in def.defaults)) throw new Error(`${def.label} has no setting called "${key}".`)
  }
  return { ...values }
}

/** Did the old writer take this? */
const oldTook = (def: SectionDef, values: Record<string, unknown>) => {
  try {
    const out = wasOpen(def, values)
    const [key] = Object.keys(values)
    return out[key] === values[key]
  } catch {
    return false
  }
}

/** Does the new one refuse it, and with a message? */
const refused = (def: SectionDef, values: Record<string, unknown>) => {
  try {
    validateValues(def, values)
    return null
  } catch (e) {
    return e instanceof Error && e.message.length > 0 ? e.message : null
  }
}

/** What the new one stores. Throws if it refuses. */
const stored = (def: SectionDef, values: Record<string, unknown>) => validateValues(def, values)

const HERO = SECTIONS.hero
const INTRO = SECTIONS.intro

/** Every section and field in the registry, so nothing is tested only on the hero. */
const allFields: { def: SectionDef; field: Field }[] = []
for (const def of Object.values(SECTIONS)) {
  for (const field of def.fields) allFields.push({ def, field })
}

const firstOf = (kind: Field['kind']) => allFields.find((f) => f.field.kind === kind)

// ════════════════════════════════════════════════════════════════════════════
// 1. A `select` outside its own options
// ════════════════════════════════════════════════════════════════════════════
//
// The one with teeth: several of these are written into the markup as a
// `data-` attribute or read by a renderer that switches on them, so a value
// nobody wrote a branch for is a section that draws nothing or draws wrongly.

{
  const bad = { backdrop: 'iframe' }
  ok('select: the old writer stored a value the field never offered', oldTook(HERO, bad))
  ok('select: an option the field does not offer is refused', refused(HERO, bad) !== null)

  // And every option it DOES offer is taken, for every select in the registry.
  for (const { def, field } of allFields) {
    if (field.kind !== 'select') continue
    for (const option of field.options) {
      let got: unknown = Symbol('threw')
      try {
        got = stored(def, { [field.key]: option.value })[field.key]
      } catch {
        /* leaves the symbol */
      }
      ok(
        `select: ${def.type}.${field.key} accepts its own option "${option.value}"`,
        got === option.value,
        'the panel can produce this; refusing it is "Minified React error #441"'
      )
    }
  }

  // Case matters — these are compared with `===` by renderers, not folded.
  ok('select: a differently-cased option is refused', refused(HERO, { backdrop: 'IMAGE' }) !== null)
  // The legacy hero escape hatch the editor itself writes.
  ok(
    'select: hide_on "none" is accepted',
    stored(INTRO, { hide_on: 'none' }).hide_on === 'none',
    'components/canvas/Inspector.tsx writes exactly this to clear a legacy hidden hero'
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 2. A colour that is not a colour
// ════════════════════════════════════════════════════════════════════════════
//
// `backdrop_color` is written into the page as a CSS custom property, so this
// is the value with the shortest path from a request to a stylesheet.

{
  const bad = { backdrop_color: '#nope' }
  ok('color: the old writer stored a non-hex', oldTook(HERO, bad))
  ok('color: a non-hex is refused', refused(HERO, bad) !== null)

  for (const value of [
    'red',
    '#fff',
    '#ffffff00',
    'rgb(1,2,3)',
    '#c97a4a; background-image: url(x)',
    'var(--ink)',
    '',
  ]) {
    ok(
      `color: "${value}" is refused`,
      refused(HERO, { backdrop_color: value }) !== null,
      'the page turns this straight into CSS'
    )
  }

  // A hex is taken, and lower-cased the same way the form path lower-cases it,
  // so the two writers cannot store two spellings of one colour.
  ok(
    'color: #C97A4A is stored as #c97a4a',
    stored(HERO, { backdrop_color: '#C97A4A' }).backdrop_color === '#c97a4a'
  )
  ok(
    'color: surrounding space is trimmed, as the form path trims it',
    stored(HERO, { backdrop_color: '  #123abc  ' }).backdrop_color === '#123abc'
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 3. A number outside its declared range, and a number that is not one
// ════════════════════════════════════════════════════════════════════════════
//
// CLAMPED, not refused — because that is what the form path has always done,
// and the requirement is that the two writers agree. `dim` is 0–80.

{
  const dim = HERO.fields.find((f) => f.key === 'dim')
  ok('number: `dim` is still declared 0–80', dim?.kind === 'number' && dim.min === 0 && dim.max === 80)

  ok('number: the old writer stored 900 in a slider that stops at 80', oldTook(HERO, { dim: 900 }))
  ok('number: 900 is clamped to 80', stored(HERO, { dim: 900 }).dim === 80)
  ok('number: -5 is clamped to 0', stored(HERO, { dim: -5 }).dim === 0)
  ok('number: 40 is stored as 40', stored(HERO, { dim: 40 }).dim === 40)

  // The form path, given the same three, must agree exactly. This is the
  // assertion that says "one set of rules" rather than "two that look alike".
  for (const raw of ['900', '-5', '40', '0', '80']) {
    const form = new FormData()
    form.set('__present_dim', '1')
    form.set('dim', raw)
    const viaForm = readSettingsFromForm(HERO, form, resolveSettings('hero', {})).dim
    const viaValues = stored(HERO, { dim: Number(raw) }).dim
    ok(`number: the two writers agree on ${raw} (${String(viaForm)})`, viaForm === viaValues)
  }

  // Not a number at all. NaN and the two infinities are in here on purpose:
  // each is `typeof 'number'`, so a check that only looked at the type would
  // let all three through and `Math.min/Math.max` would carry NaN straight out
  // the other side.
  const notNumbers: [string, unknown][] = [
    ['the string "40"', '40'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['null', null],
    ['true', true],
    ['a list', [40]],
    ['an object', { v: 40 }],
  ]
  for (const [name, value] of notNumbers) {
    ok(
      `number: ${name} is refused`,
      refused(HERO, { dim: value }) !== null,
      'a renderer does arithmetic on this'
    )
  }
  ok('number: the old writer stored the STRING "40"', oldTook(HERO, { dim: '40' }))
}

// ════════════════════════════════════════════════════════════════════════════
// 4. The wrong JS type, for every kind
// ════════════════════════════════════════════════════════════════════════════

{
  const toggle = firstOf('toggle')
  ok('there is a toggle field to test', toggle !== undefined)
  if (toggle) {
    const { def, field } = toggle
    for (const value of ['on', 'true', 1, 0, null, {}]) {
      ok(
        `toggle: ${def.type}.${field.key} refuses ${JSON.stringify(value)}`,
        refused(def, { [field.key]: value }) !== null
      )
    }
    ok(`toggle: true is stored`, stored(def, { [field.key]: true })[field.key] === true)
    ok(`toggle: false is stored`, stored(def, { [field.key]: false })[field.key] === false)
    ok(
      'toggle: the old writer stored the string "on"',
      oldTook(def, { [field.key]: 'on' }),
      'which is truthy, so the setting reads as on and can never be turned off'
    )
  }

  // Text and image fields take a string or nothing; an object or a list is a
  // renderer interpolating "[object Object]" into the page.
  const text = allFields.find((f) => f.field.kind === 'text')!
  for (const value of [{ x: 1 }, ['a'], 42, true]) {
    ok(
      `text: ${text.def.type}.${text.field.key} refuses ${JSON.stringify(value)}`,
      refused(text.def, { [text.field.key]: value }) !== null
    )
  }
  ok(
    'text: the old writer stored an object where a string belongs',
    oldTook(text.def, { [text.field.key]: { x: 1 } })
  )

  const image = allFields.find((f) => f.field.kind === 'image')!
  ok(
    `image: ${image.def.type}.${image.field.key} refuses a list of paths`,
    refused(image.def, { [image.field.key]: ['a.jpg'] }) !== null
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 5. NULL IS FOLLOWING, and it has to stay valid
// ════════════════════════════════════════════════════════════════════════════
//
// The commonest gesture in the panel: "Follow desktop" writes null to the
// narrower size's key, and `overrideValue` writes null every time a phone
// value comes back equal to the desktop's. Refusing it would break the phone
// half of the editor, on every per-size field, including the number and the
// colour — which is exactly the shape of mistake a value validator invites.

{
  for (const { def, field } of allFields) {
    if (!field.device) continue
    for (const device of DEVICES) {
      if (device === BASE_DEVICE) continue
      const key = deviceKey(field.key, device)
      let got: unknown = Symbol('threw')
      try {
        got = stored(def, { [key]: null })[key]
      } catch {
        /* leaves the symbol */
      }
      ok(
        `follow: ${def.type}.${key} accepts null`,
        got === null,
        'null is FOLLOWING, not "none" — the Follow desktop button writes exactly this'
      )
    }
  }

  // And a twin is governed by the base field's own rules, not by nothing.
  ok('follow: image_path_mobile takes a path', stored(HERO, { image_path_mobile: 'a/b.jpg' }).image_path_mobile === 'a/b.jpg')
  ok('follow: dim_mobile is clamped like dim', stored(HERO, { dim_mobile: 900 }).dim_mobile === 80)
  ok('follow: backdrop_mobile refuses an unoffered option', refused(HERO, { backdrop_mobile: 'iframe' }) !== null)
  ok('follow: backdrop_color_mobile refuses a non-hex', refused(HERO, { backdrop_color_mobile: 'red' }) !== null)
  ok(
    'follow: the old writer stored a non-hex on the phone too',
    oldTook(HERO, { backdrop_color_mobile: 'red' })
  )

  // An emptied box. The form path stores null for one, so the editor really
  // does produce this for a cleared title and a photograph removed from a
  // picker — on the base key, not only on a twin.
  ok('empty: a cleared image_path is null', stored(HERO, { image_path: null }).image_path === null)
  ok('empty: a cleared title is null', stored(HERO, { title: null }).title === null)
  ok('empty: an empty string becomes null, as the form path does', stored(HERO, { title: '   ' }).title === null)
  // But not for the kinds the panel never submits empty.
  ok('empty: a select cannot be emptied', refused(HERO, { backdrop: null }) !== null)
  ok('empty: a number cannot be emptied', refused(HERO, { dim: null }) !== null)
}

// ════════════════════════════════════════════════════════════════════════════
// 6. THE KEYS WITH NO FIELD BEHIND THEM pass through untouched
// ════════════════════════════════════════════════════════════════════════════
//
// The typography bags, the visibility bag, the retired section-wide type
// override and each placement's phone value. They have no declared kind, which
// is what carries them across a change of look — and four of them are handed to
// their own sanitizers immediately afterwards, so this must not normalise,
// reject or reshape them on the way.

{
  const passthrough: Record<string, unknown> = {
    text: { title: { size: 3 } },
    text_mobile: { title: { size: 2 } },
    shown: { title: 'desktop' },
    type: {},
    title_spot_mobile: 'top-left',
    subtitle_spot_mobile: null,
    cta_spot_mobile: 'center-center',
  }

  for (const [key, value] of Object.entries(passthrough)) {
    ok(`passthrough: hero.${key} is a real key`, key in HERO.defaults)
    ok(`passthrough: no field declares hero.${key}`, fieldForKey(HERO, key) === null)
    let got: unknown = Symbol('threw')
    try {
      got = stored(HERO, { [key]: value })[key]
    } catch {
      /* leaves the symbol */
    }
    ok(
      `passthrough: hero.${key} arrives at its sanitizer unchanged`,
      got === value,
      'the same object, not a copy and not a normalised version'
    )
  }

  // A rubbish value in one of these is still passed through — this validator
  // is not the thing that checks them, and pretending otherwise would leave
  // two half-checks where there is one whole one.
  ok('passthrough: a rubbish `shown` is left to sanitizeShown', stored(HERO, { shown: 'nonsense' }).shown === 'nonsense')

  // And a key nothing declares at all is still refused outright, which is the
  // check that was already there.
  ok('unknown keys are still refused', refused(HERO, { made_up_setting: 1 }) !== null)
  ok(
    'unknown keys: the message still names the section',
    (refused(HERO, { made_up_setting: 1 }) ?? '').includes(HERO.label)
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 7. A `custom` field is left alone
// ════════════════════════════════════════════════════════════════════════════
//
// A focal point, a story chooser, a mark image. Each has a purpose-built editor
// with its own shape; the generic panel never draws them and `readField`
// already leaves them exactly as they were. Validating them would mean a
// per-editor schema, which is a different change.

{
  const focal = { x: 0.4, y: 0.6, mx: 0.5, my: 0.2 }
  ok('custom: a focal point is stored as it arrives', stored(HERO, { focal }).focal === focal)

  for (const { def, field } of allFields) {
    if (field.kind !== 'custom') continue
    const probe = { anything: true }
    let got: unknown = Symbol('threw')
    try {
      got = stored(def, { [field.key]: probe })[field.key]
    } catch {
      /* leaves the symbol */
    }
    ok(`custom: ${def.type}.${field.key} is not validated`, got === probe)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 8. EVERY VALUE THE EDITOR CAN ALREADY PRODUCE IS STILL ACCEPTED
// ════════════════════════════════════════════════════════════════════════════
//
// The assertion this change lives or dies by, in three shapes.

{
  /*
   * 8a. Every default. A default is a value the renderer was written for and
   * the one every new section starts with; a validator that refuses one would
   * refuse a section nobody has touched.
   *
   * TWO DEFAULTS DO NOT MATCH THEIR OWN FIELD, and are listed here rather than
   * quietly accommodated. Both are a `select` whose options are the STRINGS
   * '2', '3', '4' and whose default is the NUMBER 3:
   *
   *   · galleries.columns
   *   · journal.grid_columns
   *
   * So a section nobody has opened carries the number and a section saved once
   * carries the string. Both render, because the three renderers read it
   * through `num(settings, 'columns', 3)` (GalleriesSection, JournalSection,
   * ShopSection) rather than comparing it — `shop.columns` is declared a
   * `number` field and is not affected.
   *
   * Nothing sends either of these through this action: a `select` is drawn by
   * the generic panel, which saves through the FormData path, and that path has
   * always written the string. They are left refused, and reported, because the
   * field declaration is the thing that says what the value is and a validator
   * that accepts two types for one setting is not a validator. Making the
   * defaults '3' is a one-line registry change and a separate decision.
   */
  const MISMATCHED_DEFAULTS = new Set(['galleries.columns', 'journal.grid_columns'])

  for (const [type, def] of Object.entries(SECTIONS)) {
    const full = resolveSettings(type, {}) as SectionSettings
    for (const [key, value] of Object.entries(full)) {
      let got: unknown = Symbol('threw')
      let why = ''
      try {
        got = stored(def, { [key]: value })[key]
      } catch (e) {
        why = e instanceof Error ? e.message : String(e)
      }

      if (MISMATCHED_DEFAULTS.has(`${type}.${key}`)) {
        const field = fieldForKey(def, key)?.field
        ok(
          `default (known): ${type}.${key} is a number under a select of strings`,
          why !== '' &&
            field?.kind === 'select' &&
            typeof value === 'number' &&
            field.options.some((o) => o.value === String(value)),
          'listed above. If this assertion fails the registry was changed and the list should shrink'
        )
        continue
      }

      ok(
        `default: ${type}.${key} survives its own validator`,
        got === value || (got === null && value === null),
        why || `stored ${JSON.stringify(got)} instead of ${JSON.stringify(value)}`
      )
    }
  }

  // 8b. Whatever the FORM path writes, the programmatic path must accept
  // unchanged. The two writers are supposed to be the same rules; this is the
  // test that says so rather than assuming it.
  let roundTripped = 0
  for (const [type, def] of Object.entries(SECTIONS)) {
    const current = resolveSettings(type, {}) as SectionSettings

    for (const device of DEVICES) {
      const form = new FormData()
      form.set('__device', device)
      for (const field of def.fields) {
        if (field.kind === 'custom') continue
        form.set(`__present_${field.key}`, '1')
        switch (field.kind) {
          case 'toggle':
            form.set(field.key, 'on')
            break
          case 'number':
            // Deliberately out of range, so the clamp is part of what is
            // compared rather than a path neither writer takes.
            form.set(field.key, '9999')
            break
          case 'color':
            form.set(field.key, '#C97A4A')
            break
          case 'select':
            form.set(field.key, field.options[field.options.length - 1]!.value)
            break
          case 'image':
            form.set(field.key, 'sites/x/photo.jpg')
            break
          default:
            form.set(field.key, '  Some words  ')
        }
      }

      const written = readSettingsFromForm(def, form, current)
      // Only the keys the form actually set — `readSettingsFromForm` returns
      // the whole bag, and 8a has already covered the untouched ones.
      const changed: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(written)) {
        if (!(key in current) || current[key] !== value) changed[key] = value
      }

      let out: SectionSettings | null = null
      let why = ''
      try {
        out = stored(def, changed)
      } catch (e) {
        why = e instanceof Error ? e.message : String(e)
      }
      ok(`round trip: ${type} on ${device} is accepted`, out !== null, why)
      if (!out) continue
      for (const [key, value] of Object.entries(changed)) {
        roundTripped++
        ok(
          `round trip: ${type}.${key} on ${device} is stored as the form wrote it`,
          out[key] === value,
          `form wrote ${JSON.stringify(value)}, validator stored ${JSON.stringify(out[key])}`
        )
      }
    }
  }

  /*
   * And the block above actually did something.
   *
   * `changed` is computed by diffing against the current settings, so a bug in
   * that diff — or a `when` that hides everything — would leave it empty and
   * every assertion in the loop would pass by never running. One number is
   * enough to make that impossible; it only has to move when the registry
   * grows, and it is a floor rather than an equality for exactly that reason.
   */
  ok(
    `round trip: it compared a realistic number of values (${roundTripped})`,
    roundTripped > 150,
    'an empty diff would make the whole block vacuous'
  )

  // 8c. Idempotent. Whatever comes out has to go back in unchanged, or two
  // saves of one value would store two different things.
  for (const [type, def] of Object.entries(SECTIONS)) {
    const full = resolveSettings(type, {}) as SectionSettings
    // Minus the two the registry declares inconsistently — see 8a.
    for (const key of Object.keys(full)) {
      if (MISMATCHED_DEFAULTS.has(`${type}.${key}`)) delete full[key]
    }
    const once = stored(def, full as Record<string, unknown>)
    const twice = stored(def, once as Record<string, unknown>)
    ok(
      `idempotent: ${type} validates to the same thing twice`,
      JSON.stringify(once) === JSON.stringify(twice)
    )
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 9. THE ACTION STILL DOES THE FOUR THINGS IT DID BEFORE
// ════════════════════════════════════════════════════════════════════════════
//
// `app/actions/canvas.ts` cannot be imported here — it is a server action and
// pulls in cookies, a Supabase client and the draft store. So this is asserted
// by reading the source, the way `.mk/preview-chrome.ts` asserts on a
// stylesheet: the sanitizers are not replaced by the new validator, and the
// validator's result is what gets written.

{
  const src = readFileSync('/home/claude/build/app/actions/canvas.ts', 'utf8')
  const action = src.slice(src.indexOf('export async function updateDraftSectionValues'))
  const body = action.slice(0, action.indexOf('export async function updateDraftStyles'))

  for (const call of ['sanitizeOwnStyle(', 'sanitizeTextStyles(', 'sanitizeShown(']) {
    ok(`the action still calls ${call})`, body.includes(call), 'preserved, not replaced')
  }
  ok('the action still sanitizes text_mobile', body.includes("'text_mobile' in values"))
  ok('the action validates values', body.includes('validateValues(def, values)'))
  ok(
    'and validates BEFORE the sanitizers, so a bag reaches its sanitizer whole',
    body.indexOf('validateValues(def, values)') < body.indexOf('sanitizeOwnStyle(')
  )
  // The key-existence check moved into the validator; it must not be left
  // behind in both places, and it must not have been dropped from either.
  ok(
    'the key-existence message lives in the validator now',
    readFileSync('/home/claude/build/lib/sections/values.ts', 'utf8').includes(
      'has no setting called'
    ) && !body.includes('has no setting called')
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 10. fieldForKey maps every key it should, and nothing it should not
// ════════════════════════════════════════════════════════════════════════════

{
  for (const { def, field } of allFields) {
    const direct = fieldForKey(def, field.key)
    ok(`fieldForKey: ${def.type}.${field.key} finds its own field`, direct?.field === field)
    ok(`fieldForKey: ${def.type}.${field.key} is not a twin`, direct?.twin === false)

    if (!field.device) {
      // A field that cannot differ by size must not lend its rules to a key
      // that does not exist — `derivedDefaults` never made room for one.
      ok(
        `fieldForKey: ${def.type}.${field.key}_mobile is not claimed`,
        fieldForKey(def, `${field.key}_mobile`) === null
      )
      continue
    }
    for (const device of DEVICES) {
      if (device === BASE_DEVICE) continue
      const twin = fieldForKey(def, deviceKey(field.key, device))
      ok(`fieldForKey: ${def.type}.${field.key} on ${device} maps to the base field`, twin?.field === field)
      ok(`fieldForKey: ${def.type}.${field.key} on ${device} is a twin`, twin?.twin === true)
    }
  }

  // checkValue on a custom field is the identity, whatever `twin` says.
  const custom = firstOf('custom')!
  const payload = { whatever: 1 }
  for (const twin of [true, false]) {
    const got = checkValue(custom.field, payload, twin)
    ok(`checkValue: custom is untouched (twin=${twin})`, got.ok && got.value === payload)
  }
}

console.log(`${pass + fail.length} assertions`)
for (const f of fail) console.log('FAIL ' + f)
console.log(`\n${pass} passed, ${fail.length} failed`)
process.exit(fail.length ? 1 : 0)
