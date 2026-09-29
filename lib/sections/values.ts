import { BASE_DEVICE, DEVICES } from '@/lib/sections/devices'
import type { Field, SectionDef, SectionSettings } from '@/lib/sections/registry'

/**
 * ONE SET OF FIELD RULES, TWO FAILURE POLICIES
 * ════════════════════════════════════════════
 *
 * There are two writers into a section's settings and until now only one of
 * them checked what it was given.
 *
 *   · `updateDraftSection` reads a submitted panel through
 *     `readSettingsFromForm`, which goes field by field: a colour that is not a
 *     hex is refused, a `select` outside its own options is refused, a number
 *     is clamped into its declared range. Everything it refuses, it refuses by
 *     LEAVING THE SETTING AS IT WAS — the person is looking at the panel, the
 *     control snaps back on the next render, and that is the whole message.
 *
 *   · `updateDraftSectionValues` is how the custom editors save — a focal
 *     point, a story chooser, an image picker, a drag in the preview. It
 *     checked that the KEY existed and wrote whatever value came with it. A
 *     crafted request could put `'; drop'` in a `select`, `#nope` in a colour
 *     that the page turns straight into CSS, or a string where a renderer does
 *     arithmetic.
 *
 * The rules themselves are the same rules — there is no second schema here,
 * and that is the point of this file. What differs is what happens when a
 * value fails them:
 *
 *   · from a FORM, fall back to the current value. The panel is on screen.
 *   · PROGRAMMATICALLY, throw. There is no panel to snap back, the caller is
 *     code, and silently storing something else is how a wrong value becomes
 *     permanent.
 *
 * Writing them twice was never an option: a second copy is how the two come to
 * disagree, and the one that disagrees quietly is the one nobody is watching.
 *
 * ── What is deliberately NOT checked here ───────────────────────────────────
 *
 * A key with no field behind it. The editor writes several on purpose — the
 * per-element typography bags (`text`, `text_mobile`), the visibility bag
 * (`shown`), the section-wide type override (`type`), and each placement's
 * phone value (`title_spot_mobile` and its two siblings). Those have no
 * declared kind to check against, which is exactly what carries them across a
 * change of look (`splitSettings` counts a key with no field as the
 * photographer's). Four of them have their own sanitizers in
 * `app/actions/canvas.ts`, which run after this and are not replaced by it; the
 * placements are checked at the one place they cross a window boundary
 * (`components/canvas/Canvas.tsx`). A key that is in neither this file's reach
 * nor the section's `defaults` is still refused outright.
 *
 * And a `custom` field's value. A focal point, a story chooser and a mark
 * image each save through a purpose-built editor with its own shape; the
 * generic panel never draws them and `readField` already leaves them alone.
 * Validating them would mean a per-editor schema, which is real work and not
 * this change.
 */

export type ValueCheck = { ok: true; value: unknown } | { ok: false; why: string }

type NumberField = Extract<Field, { kind: 'number' }>
type SelectField = Extract<Field, { kind: 'select' }>

/** A #rrggbb hex, which the page writes straight into CSS. */
const HEX = /^#[0-9a-f]{6}$/i

/**
 * Inside its declared range.
 *
 * CLAMPED rather than refused, because that is what the form path has always
 * done and consistency between the two writers is the requirement: 200 in a
 * slider that goes to 80 has always been stored as 80, and a programmatic
 * caller that sent 200 should get the same 80 rather than an error the form
 * would never have raised.
 */
export function clampNumber(field: NumberField, n: number): number {
  const min = field.min ?? -Infinity
  const max = field.max ?? Infinity
  return Math.min(max, Math.max(min, n))
}

/** The trimmed hex in lower case, or null if it is not one. */
export function normalizeColor(raw: string): string | null {
  const trimmed = raw.trim()
  return HEX.test(trimmed) ? trimmed.toLowerCase() : null
}

/** The value if the field offers it, or null if it does not. */
export function normalizeSelect(field: SelectField, raw: string): string | null {
  const trimmed = raw.trim()
  return field.options.some((o) => o.value === trimmed) ? trimmed : null
}

/** Trimmed, and empty means nothing set rather than an empty string. */
export function normalizeText(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * WHICH FIELD GOVERNS A SETTINGS KEY.
 *
 * Mostly the field of the same name. The exception is a narrower size's twin:
 * `image_path_mobile` is governed by `image_path`'s own declaration, because
 * the whole idea of a per-size setting is that it is the SAME setting seen at
 * a different width — a phone photograph is still a photograph and a phone
 * `dim` is still a number between 0 and 80.
 *
 * `null` means no field declares this key. Its value is passed through
 * untouched; see the note at the top of this file.
 */
export function fieldForKey(
  def: SectionDef,
  key: string
): { field: Field; twin: boolean } | null {
  const direct = def.fields.find((f) => f.key === key)
  if (direct) return { field: direct, twin: false }

  for (const device of DEVICES) {
    if (device === BASE_DEVICE) continue
    const suffix = `_${device}`
    if (!key.endsWith(suffix)) continue
    /*
     * And it must be a field that SAYS it can differ by size. Without that
     * check a field called `video` would quietly lend its rules to a key
     * called `video_mobile` that nothing declares and `derivedDefaults` never
     * made room for — and the key check would have refused it a line earlier
     * anyway, so the only thing such a match could do is mislead.
     */
    const base = def.fields.find((f) => f.key === key.slice(0, -suffix.length) && f.device)
    if (base) return { field: base, twin: true }
  }

  return null
}

/**
 * ONE VALUE AGAINST ITS FIELD.
 *
 * `twin` is the narrower size's key, where **null means FOLLOWING** rather
 * than "none" — it is how "set it back and it follows again" is expressed, the
 * editor writes it from two places ("Follow desktop" and the placement
 * picker's Follow), and `overrideValue` produces it every time a phone value
 * comes back equal to the desktop's. Refusing null on a twin would break the
 * commonest gesture in the panel.
 */
export function checkValue(field: Field, value: unknown, twin: boolean): ValueCheck {
  // Saved by a purpose-built editor with its own shape. See the top of the file.
  if (field.kind === 'custom') return { ok: true, value }

  if (value === null || value === undefined) {
    if (twin) return { ok: true, value: null }
    /*
     * An empty box. The form path stores null for one — `''` is not a value a
     * renderer should have to tell apart from nothing — so null is what the
     * editor itself produces for a cleared title, an unset link and a photograph
     * removed from a picker, and it has to be accepted here on the same terms.
     */
    if (field.kind === 'text' || field.kind === 'textarea' || field.kind === 'image') {
      return { ok: true, value: null }
    }
    return { ok: false, why: `${field.label} needs a value.` }
  }

  switch (field.kind) {
    case 'toggle':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, why: `${field.label} is on or off, not ${describe(value)}.` }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, why: `${field.label} is a number, not ${describe(value)}.` }
      }
      return { ok: true, value: clampNumber(field, value) }
    }

    case 'color': {
      if (typeof value !== 'string') {
        return { ok: false, why: `${field.label} is a colour, not ${describe(value)}.` }
      }
      const hex = normalizeColor(value)
      return hex
        ? { ok: true, value: hex }
        : { ok: false, why: `${field.label} has to be a colour like #c97a4a.` }
    }

    case 'select': {
      if (typeof value !== 'string') {
        return { ok: false, why: `${field.label} is a choice, not ${describe(value)}.` }
      }
      const chosen = normalizeSelect(field, value)
      return chosen !== null
        ? { ok: true, value: chosen }
        : { ok: false, why: `${field.label} has no option called "${value}".` }
    }

    default: {
      if (typeof value !== 'string') {
        return { ok: false, why: `${field.label} is text, not ${describe(value)}.` }
      }
      return { ok: true, value: normalizeText(value) }
    }
  }
}

/** What arrived, for an error message a person can act on. */
function describe(value: unknown): string {
  if (Array.isArray(value)) return 'a list'
  if (value === null) return 'nothing'
  switch (typeof value) {
    case 'object':
      return 'an object'
    case 'string':
      return 'text'
    case 'number':
      return 'a number'
    case 'boolean':
      return 'on or off'
    default:
      return typeof value
  }
}

/**
 * EVERY KEY AND VALUE IN A PROGRAMMATIC WRITE.
 *
 * Returns the settings to store — the same values, normalised the way the form
 * path normalises them (a number clamped into range, a colour in lower case,
 * text trimmed) — and throws on the first thing it cannot accept.
 *
 * Lives here rather than in the server action so that it can be tested without
 * a database, a session or a request. `.mk/section-values.ts` is that test.
 */
export function validateValues(
  def: SectionDef,
  values: Record<string, unknown>
): SectionSettings {
  const out: SectionSettings = {}

  for (const [key, value] of Object.entries(values)) {
    /*
     * A renderer may only read keys that exist, and the same discipline keeps
     * a typo out of the database. Unchanged from where this check used to
     * live, message and all: the editor surfaces it, and it is the one error
     * in this file somebody has actually seen.
     */
    if (!(key in def.defaults)) {
      throw new Error(`${def.label} has no setting called "${key}".`)
    }

    const rule = fieldForKey(def, key)
    if (!rule) {
      // No field declares it — a typography bag, the visibility bag, a
      // placement. Passed through; see the top of this file.
      out[key] = value
      continue
    }

    const checked = checkValue(rule.field, value, rule.twin)
    if (!checked.ok) throw new Error(checked.why)
    out[key] = checked.value
  }

  return out
}
