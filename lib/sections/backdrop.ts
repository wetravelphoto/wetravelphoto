import { BASE_DEVICE, deviceKey, type Device } from '@/lib/sections/devices'

/**
 * WHAT IS BEHIND THE WORDS, PER SIZE
 * ══════════════════════════════════
 *
 * A photograph, a film or a color — and not necessarily the same one on a
 * phone as on a desktop.
 *
 * ── Why this one needed to differ by size more than anything else ───────────
 *
 * Every other per-size setting is a matter of taste: a title that is too big
 * on a phone is a title that is too big. The backdrop is a matter of
 * BANDWIDTH. A five-second film that opens a wide screen beautifully is a
 * several-megabyte download on a train, and the phone gets the worse version
 * of the site for the privilege. "Video here, photograph there" is the single
 * most useful thing this whole per-device idea can express, which is why it
 * was the thing asked for.
 *
 * So the rule is not merely that the phone CAN show something else. It is that
 * when it does, the film is never fetched at that width — see FixedHero, where
 * the choice is made by `<source media>` and by not mounting a video the
 * current width will not show. A per-size backdrop that downloads both is the
 * same failure as a font picker that never fetches the font: a control that
 * looks like it works and costs the visitor exactly what it claimed to save.
 *
 * ── Following, as everywhere else ───────────────────────────────────────────
 *
 * Stored as `<key>` for the desktop and `<key>_mobile` for the phone, null
 * until set. Null is FOLLOWING, not "none": the phone shows the desktop's
 * backdrop until it is given one of its own, and setting one on the phone
 * never touches the desktop. Same terms as typography (lib/sections/
 * text-style.ts) and placement (lib/sections/spots.ts), on purpose — one rule
 * to learn rather than three.
 *
 * `focal` is deliberately NOT in here. It has been per-device since long
 * before this existed, as `x`/`y` and `mx`/`my` inside one object, and a
 * second mechanism beside the first is how the two come to disagree.
 */

export const BACKDROP_KINDS = ['image', 'video', 'color'] as const
export type BackdropKind = (typeof BACKDROP_KINDS)[number]

/**
 * The settings that make up a backdrop, and so the ones that get a phone twin.
 *
 * `dim` is in the list because a photograph that needs no darkening on a wide
 * screen often does on a phone, where the words sit over the middle of it.
 */
export const BACKDROP_KEYS = [
  'backdrop',
  'image_path',
  'video_path',
  'video_poster',
  'backdrop_color',
  'dim',
] as const

export type BackdropKey = (typeof BACKDROP_KEYS)[number]

export const DEFAULT_BACKDROP_COLOR = '#14100e'

export type BackdropValues = {
  kind: BackdropKind
  imagePath: string | null
  videoPath: string | null
  posterPath: string | null
  color: string
  dim: number
}

/**
 * One setting as a given size resolves it: its own value if it has one, and
 * the base device's otherwise.
 *
 * Generic rather than backdrop-specific — it is the whole of what "the phone
 * follows the desktop" means, and any setting that becomes per-device later
 * wants exactly this.
 */
export function deviceValue(
  settings: Record<string, unknown>,
  key: string,
  device: Device
): unknown {
  if (device === BASE_DEVICE) return settings[key]
  const own = settings[deviceKey(key, device)]
  return own === null || own === undefined ? settings[key] : own
}

/** Has this size been given a backdrop of its own, in any part? */
export function hasOwnBackdrop(settings: Record<string, unknown>, device: Device): boolean {
  if (device === BASE_DEVICE) return true
  return BACKDROP_KEYS.some((key) => {
    const own = settings[deviceKey(key, device)]
    return own !== null && own !== undefined
  })
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/**
 * The backdrop one size actually draws.
 *
 * Sanitised on the way out as well as on the way in: the color reaches the
 * page as an inline custom property and the kind as a data attribute, so a
 * hand-edited row must not be able to put anything else there.
 */
export function backdropFor(
  settings: Record<string, unknown>,
  device: Device
): BackdropValues {
  const raw = deviceValue(settings, 'backdrop', device)
  const kind = (BACKDROP_KINDS as readonly unknown[]).includes(raw)
    ? (raw as BackdropKind)
    : 'image'

  const color = text(deviceValue(settings, 'backdrop_color', device))
  const dim = Number(deviceValue(settings, 'dim', device) ?? 0)

  return {
    kind,
    imagePath: text(deviceValue(settings, 'image_path', device)),
    videoPath: text(deviceValue(settings, 'video_path', device)),
    posterPath: text(deviceValue(settings, 'video_poster', device)),
    color: color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : DEFAULT_BACKDROP_COLOR,
    dim: Number.isFinite(dim) ? Math.min(80, Math.max(0, dim)) : 0,
  }
}

/**
 * Do the two draw DIFFERENT MEDIA?
 *
 * Only about what has to be fetched — the color and the darkening differ by
 * custom property and need nothing duplicated in the markup. This is the
 * question "does the page have to carry two backdrops", and the answer is no
 * for every site that has never touched the phone.
 */
export function backdropMediaDiffers(a: BackdropValues, b: BackdropValues): boolean {
  return (
    a.kind !== b.kind ||
    a.imagePath !== b.imagePath ||
    a.videoPath !== b.videoPath ||
    a.posterPath !== b.posterPath
  )
}

/**
 * What a size stores when it is told to match another.
 *
 * Equal to the base is FOLLOWING, not a copy of it: storing the same value
 * would freeze the inheritance, so changing the desktop photograph afterwards
 * would leave the phone on the old one having never been told to keep it.
 * This is `overrideAgainst` from text-style.ts, for a single scalar.
 */
export function overrideValue(base: unknown, next: unknown): unknown {
  if (next === base) return null
  // A number typed into a slider and one read back from the database are the
  // same value and not the same type often enough to matter.
  if (typeof base === 'number' && typeof next === 'number' && base === next) return null
  if (next === undefined) return null
  return next
}
