/**
 * Where an accent mark's picture comes from.
 *
 * Two kinds of value can sit in a mark's `image_path`:
 *
 *   · a storage key — `branding/mark-….svg` — for a file the photographer
 *     uploaded. Served from the site's bucket like every other image.
 *   · a path under /logos/ — a mark that ships with the site itself. This
 *     exists so that a site already using a built-in emblem keeps it when the
 *     mark becomes a section, without copying the file into the bucket.
 *
 * The built-in form is matched narrowly on purpose. A value starting with "/"
 * is a URL on this origin, and "//somewhere.else/x.svg" is a URL on ANY
 * origin — so anything that is not exactly /logos/<file> is treated as a
 * storage key, which can only ever resolve inside the bucket.
 *
 * Pure: imported by the renderer (server) and the canvas editor (client).
 */

const BUILT_IN = /^\/logos\/[\w.-]+$/

export function isBuiltInMark(path: string): boolean {
  return BUILT_IN.test(path)
}

export function markSrc(path: string, publicUrl: string): string {
  return isBuiltInMark(path) ? path : `${publicUrl}/${path}`
}

export const MARK_ALIGNS = ['left', 'center', 'right'] as const
export type MarkAlign = (typeof MARK_ALIGNS)[number]

export function markAlign(value: unknown): MarkAlign {
  return MARK_ALIGNS.includes(value as MarkAlign) ? (value as MarkAlign) : 'center'
}

/** Clamped to the slider's range, so a hand-edited row cannot fill the screen. */
export function markSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 64
  return Math.min(240, Math.max(24, Math.round(n)))
}
