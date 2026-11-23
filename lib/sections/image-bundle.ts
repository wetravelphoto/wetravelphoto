import { BASE_DEVICE, DEVICES, deviceKey, type Device } from '@/lib/sections/devices'
import { isSamplePhoto } from '@/lib/images'
import { isNonBlankText } from '@/lib/photos/image'
import type { Field, SectionDef, SectionSettings } from '@/lib/sections/registry'

/**
 * A SECTION PHOTOGRAPH AS THREE KEYS
 * ══════════════════════════════════
 *
 * P5. A section's photograph used to be one key — its stored path. The picker
 * now also knows WHICH photograph that is (the asset) and what this placement
 * says about it (its own alt text), and both are kept beside the path:
 *
 *     image_path            image_path_asset            image_path_alt
 *     image_path_mobile     image_path_asset_mobile     image_path_alt_mobile
 *
 * Frozen, suffix-last: `deviceKey(base + '_asset', device)` and
 * `deviceKey(base + '_alt', device)` — the same rule lib/photos/image.ts reads
 * and sync_photo_usages maps (`image_path_mobile` → `image_path_alt_mobile`,
 * never `image_path_mobile_alt`).
 *
 * The three travel together. Choosing writes all three in one save; clearing
 * clears all three; a path changed by any writer that did not also send its
 * siblings takes them down with it (`reconcileBundles`), because an asset id
 * left beside a different path is a pair the renderer refuses — the
 * photograph would vanish rather than change.
 *
 * The PATH stays authoritative. It is what P3 projects, what every page
 * written before P5 renders from, and what a rollback reads. The siblings are
 * additions and nothing is rewritten to gain them.
 *
 * A DECORATIVE slot (a background, a video's still) has no alt key at all: its
 * text is always empty by declaration, and a key that cannot exist cannot be
 * set by a crafted request either.
 *
 * No field declares a sibling, deliberately — the same reason the typography
 * bags have none: `splitSettings` counts a key with no field as the
 * photographer's, so a change of look carries the identity and the words
 * across with the photograph.
 */

/** Settings declared `kind: 'image'` that hold no photograph — a video. */
export const NOT_A_PHOTOGRAPH: ReadonlySet<string> = new Set(['video_path'])

/** The longest placement description stored. The picker's own limit is the same number. */
export const PLACEMENT_ALT_MAX = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isPhotoField(field: Field): boolean {
  return field.kind === 'image' && !NOT_A_PHOTOGRAPH.has(field.key)
}

export function photoRole(field: Field): 'content' | 'decorative' {
  return field.accessibilityRole === 'decorative' ? 'decorative' : 'content'
}

export type BundleKeys = { path: string; asset: string; alt: string | null }

/** The keys of one photograph field on one size. `alt` is null for a decorative slot. */
export function bundleKeys(field: Field, device: Device = BASE_DEVICE): BundleKeys {
  return {
    path: deviceKey(field.key, device),
    asset: deviceKey(`${field.key}_asset`, device),
    alt: photoRole(field) === 'decorative' ? null : deviceKey(`${field.key}_alt`, device),
  }
}

/** The sizes a field is stored for: the base, plus every narrower one if it can differ. */
function devicesOf(field: Field): Device[] {
  return field.device ? [...DEVICES] : [BASE_DEVICE]
}

/** Every photograph field of a section, on every size it is stored for. */
export function photoBundles(def: Pick<SectionDef, 'fields'>): Array<{ field: Field; device: Device; keys: BundleKeys }> {
  const out: Array<{ field: Field; device: Device; keys: BundleKeys }> = []
  const seen = new Set<string>()
  for (const field of def.fields) {
    if (!isPhotoField(field)) continue
    for (const device of devicesOf(field)) {
      const keys = bundleKeys(field, device)
      // A section that declares the same key twice under different `when`s
      // (the hero's photograph, full-bleed or split) stores it once.
      if (seen.has(keys.path)) continue
      seen.add(keys.path)
      out.push({ field, device, keys })
    }
  }
  return out
}

/** Storage for every sibling: null, which is "no identity, no text of its own". */
export function bundleDefaults(def: Pick<SectionDef, 'fields'>): SectionSettings {
  const out: SectionSettings = {}
  for (const { keys } of photoBundles(def)) {
    out[keys.asset] = null
    if (keys.alt) out[keys.alt] = null
  }
  return out
}

export type SiblingRule = { kind: 'asset' | 'alt'; pathKey: string; field: Field; device: Device }

/** Which photograph a sibling key belongs to, or null when it is not one. */
export function siblingFor(def: Pick<SectionDef, 'fields'>, key: string): SiblingRule | null {
  for (const { field, device, keys } of photoBundles(def)) {
    if (key === keys.asset) return { kind: 'asset', pathKey: keys.path, field, device }
    if (keys.alt && key === keys.alt) return { kind: 'alt', pathKey: keys.path, field, device }
  }
  return null
}

export type SiblingCheck = { ok: true; value: string | null } | { ok: false; why: string }

/**
 * One sibling value. An asset id is a lower-case uuid or nothing; a
 * description is text, trimmed, blank meaning unset (never "decorative"), and
 * no longer than the picker lets anybody type.
 */
export function checkSibling(rule: SiblingRule, value: unknown): SiblingCheck {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') {
    return { ok: false, why: `${rule.field.label} has a photograph setting that is not text.` }
  }
  if (rule.kind === 'asset') {
    return UUID.test(value)
      ? { ok: true, value }
      : { ok: false, why: `${rule.field.label} names a photograph that is not one of this site’s.` }
  }
  return placementText(value, rule.field.label)
}

/**
 * A placement description as stored: trimmed, and blank — by P5's ONE blank
 * rule (lib/photos/image.ts `isNonBlankText`, the database's own set: every
 * Unicode space and line break plus the zero-width marks) — meaning unset,
 * never "decorative". So an invisible-only description is never saved as text
 * the renderer would then ignore.
 */
export function placementText(value: string, label: string): SiblingCheck {
  if (!isNonBlankText(value)) return { ok: true, value: null }
  const trimmed = value.trim()
  if (trimmed.length > PLACEMENT_ALT_MAX) {
    return { ok: false, why: `${label}’s description is longer than ${PLACEMENT_ALT_MAX} characters.` }
  }
  return { ok: true, value: trimmed }
}

/** A description as the panel holds it: the stored rule, without the length refusal. */
export const shownText = (v: unknown): string | null => (isNonBlankText(v) ? v.trim() : null)

/** What a picker hands back for one slot, or null to clear it. */
export type PhotoChoice = { path: string; assetId: string | null; alt: string | null }

/**
 * The values a choice writes — every key of the bundle, in one object, so one
 * save carries all three. A decorative slot writes no text. Null clears the
 * whole bundle, which on a narrower size is "follow the desktop".
 */
export function bundleValues(field: Field, device: Device, choice: PhotoChoice | null): Record<string, unknown> {
  const keys = bundleKeys(field, device)
  const out: Record<string, unknown> = {
    [keys.path]: choice ? choice.path : null,
    [keys.asset]: choice ? choice.assetId : null,
  }
  if (keys.alt) out[keys.alt] = choice ? choice.alt : null
  return out
}

/** The bundle a size actually stores for itself — not what it inherits. */
export function ownBundle(field: Field, device: Device, settings: SectionSettings): PhotoChoice | null {
  const keys = bundleKeys(field, device)
  const path = settings[keys.path]
  if (typeof path !== 'string' || path === '') return null
  const asset = settings[keys.asset]
  const alt = keys.alt ? settings[keys.alt] : null
  return {
    path,
    assetId: typeof asset === 'string' && asset !== '' ? asset : null,
    alt: shownText(alt),
  }
}

/**
 * What a slot stores when its picker is confirmed.
 *
 * A narrower size goes back to FOLLOWING (stores nothing) only when the
 * picker says so — `keepsInherited`: it was following, and the photographer
 * kept exactly what it follows with no words of its own — or through the
 * panel's explicit "Follow desktop". Anything else is the size's OWN choice,
 * even the desktop's own photograph with no words: a phone that was given its
 * own photograph keeps it, so a later desktop change does not quietly take the
 * phone with it. The description goes through the same blank rule as storage.
 */
export function confirmedChoice(
  narrower: boolean,
  keepsInherited: boolean,
  choice: PhotoChoice | null
): PhotoChoice | null {
  if (narrower && keepsInherited) return null
  if (!choice) return null
  return { path: choice.path, assetId: choice.assetId, alt: shownText(choice.alt) }
}

/** Whether two stored choices are the same bundle. */
export const sameChoice = (a: PhotoChoice | null, b: PhotoChoice | null) =>
  a === b || (!!a && !!b && a.path === b.path && a.assetId === b.assetId && a.alt === b.alt)

/**
 * EVERY PATH CHANGE TAKES ITS SIBLINGS WITH IT.
 *
 * Given the stored settings and what is about to be merged over them: for
 * each photograph whose path changes in this write, any sibling the write did
 * not mention is cleared. Then the merged result is checked — an identity or
 * a description with no path of its own beside it, or an identity beside a
 * built-in sample, is refused. Throws; the programmatic writer's policy.
 */
export function reconcileBundles(
  def: Pick<SectionDef, 'fields' | 'label'>,
  current: SectionSettings,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...values }
  for (const { keys } of photoBundles(def)) {
    if (!(keys.path in out) || (out[keys.path] ?? null) === (current[keys.path] ?? null)) continue
    // Only what is there: a section that never had an identity gains no keys.
    if (!(keys.asset in out) && current[keys.asset] != null) out[keys.asset] = null
    if (keys.alt && !(keys.alt in out) && current[keys.alt] != null) out[keys.alt] = null
  }

  const merged = { ...current, ...out }
  for (const { field, keys } of photoBundles(def)) {
    const path = merged[keys.path]
    const hasPath = typeof path === 'string' && path !== ''
    const asset = merged[keys.asset]
    const alt = keys.alt ? merged[keys.alt] : null
    const touched = keys.path in out || keys.asset in out || (keys.alt !== null && keys.alt in out)
    if (!touched) continue
    if (asset !== null && asset !== undefined) {
      if (!hasPath) throw new Error(`${field.label}: a photograph was named with no file beside it.`)
      if (isSamplePhoto(path as string)) throw new Error(`${field.label}: a built-in sample is not a library photograph.`)
    }
    if (alt !== null && alt !== undefined && !hasPath) {
      throw new Error(`${field.label}: a description was given with no photograph to describe.`)
    }
  }
  return out
}

/** The asset/path pairs a write asks to store, for the server to check belong to the site. */
export function assetPairs(
  def: Pick<SectionDef, 'fields'>,
  merged: SectionSettings,
  values: Record<string, unknown>
): Array<{ key: string; assetId: string; path: string }> {
  const out: Array<{ key: string; assetId: string; path: string }> = []
  for (const { keys } of photoBundles(def)) {
    if (!(keys.asset in values) && !(keys.path in values)) continue
    const asset = merged[keys.asset]
    const path = merged[keys.path]
    if (typeof asset === 'string' && typeof path === 'string') out.push({ key: keys.asset, assetId: asset, path })
  }
  return out
}
