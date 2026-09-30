import exifr from 'exifr'

/**
 * WHAT A PHOTOGRAPH SAYS ABOUT ITSELF, NORMALISED
 * ═══════════════════════════════════════════════
 *
 * One reader for all four upload routes (claude/photo-assets-design.md §9.5).
 * It produces the normalised capture columns and a small, allowlisted `exif`
 * object — never a raw dump. The database checks the same shape again
 * (upsert_photo_asset), so anything this lets through that it should not is
 * refused there rather than stored.
 *
 * Two rules worth knowing before changing anything here:
 *
 *   · Optional metadata never fails an upload. A value that is missing, the
 *     wrong type or out of range becomes NULL (a string that is too long is
 *     cut). A camera that writes nonsense still gets its photograph uploaded.
 *   · GEOLOCATION IS NOT UNIVERSAL. Only a gallery upload stored latitude and
 *     longitude before P2, so only `{ gps: true }` reads them. The other
 *     routes do not even ask exifr for GPS, and their database wrappers have no
 *     parameter to put it in.
 */

export type Capture = {
  taken_at: string | null
  camera_make: string | null
  camera_model: string | null
  lens: string | null
  iso: number | null
  aperture: number | null
  shutter: string | null
  focal_length: number | null
  keywords: string[]
  exif: ExifSubset | Record<string, never>
  latitude: number | null
  longitude: number | null
}

export type ExifSubset = {
  v: 1
  orientation?: number
  offset_time?: string
  exposure_program?: string
  exposure_mode?: string
  exposure_bias_ev?: number
  metering_mode?: string
  flash_fired?: boolean
  white_balance?: string
  focal_length_35mm?: number
  lens_make?: string
  color_space?: string
  software?: string
}

/** The allowlist, in one place, so `.mk/ingest.ts` can hold it to the SQL. */
export const EXIF_KEYS = [
  'v',
  'orientation',
  'offset_time',
  'exposure_program',
  'exposure_mode',
  'exposure_bias_ev',
  'metering_mode',
  'flash_fired',
  'white_balance',
  'focal_length_35mm',
  'lens_make',
  'color_space',
  'software',
] as const

export const EXIF_MAX_BYTES = 1024

const EMPTY: Capture = {
  taken_at: null,
  camera_make: null,
  camera_model: null,
  lens: null,
  iso: null,
  aperture: null,
  shutter: null,
  focal_length: null,
  keywords: [],
  exif: {},
  latitude: null,
  longitude: null,
}

// ── Small, strict converters ────────────────────────────────────────────────

// Control characters out, whitespace trimmed, cut to `max`, empty → null.
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max).trim()
  return clean === '' ? null : clean
}

function number(value: unknown): number | null {
  const n = Array.isArray(value) ? value[0] : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function ranged(value: number | null, min: number, max: number): number | null {
  return value !== null && value >= min && value <= max ? value : null
}

const tenth = (n: number) => Math.round(n * 10) / 10

/** `1/250` below a second, `2s` or `2.5s` at or above. */
export function formatShutter(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null
  if (seconds < 1) {
    const n = Math.round(1 / seconds)
    return n >= 1 && n <= 999999 ? `1/${n}` : null
  }
  const s = tenth(seconds)
  if (s > 9999.9) return null
  return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`
}

function lensFrom(meta: Record<string, unknown>): string | null {
  const model = text(meta.LensModel, 96)
  if (model) return model
  const info = meta.LensInfo
  if (Array.isArray(info) && info.length === 4 && info.every((n) => typeof n === 'number')) {
    const [minF, maxF, minA] = info as number[]
    const focal = minF === maxF ? `${minF}mm` : `${minF}-${maxF}mm`
    return text(Number.isFinite(minA) && minA > 0 ? `${focal} f/${minA}` : focal, 96)
  }
  return text(info, 96)
}

/**
 * The keyword rule `registerPhoto` has always used for `photos.tags` — strings
 * only, trimmed, lower-cased, empties dropped, the first 25 — plus two limits
 * the database now enforces: control characters removed and at most 200
 * characters each. Those two change nothing for any keyword a person typed.
 */
export function normalizeKeywords(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  return list
    .filter((k: unknown): k is string => typeof k === 'string')
    .map((k) => text(k.toLowerCase(), 200))
    .filter((k): k is string => k !== null)
    .slice(0, 25)
}

const PROGRAM: Record<number, string> = {
  1: 'manual', 2: 'program', 3: 'aperture_priority', 4: 'shutter_priority',
  5: 'creative', 6: 'action', 7: 'portrait', 8: 'landscape', 9: 'other',
}
const EXPOSURE_MODE: Record<number, string> = { 0: 'auto', 1: 'manual', 2: 'bracket' }
const METERING: Record<number, string> = {
  1: 'average', 2: 'center_weighted', 3: 'spot', 4: 'multi_spot', 5: 'pattern', 6: 'partial', 255: 'other',
}
const WHITE_BALANCE: Record<number, string> = { 0: 'auto', 1: 'manual' }
const COLOR_SPACE: Record<number, string> = { 1: 'srgb', 2: 'adobe_rgb', 65535: 'uncalibrated' }

function coded(value: unknown, table: Record<number, string>): string | undefined {
  const n = number(value)
  return n === null ? undefined : table[n]
}

/**
 * The normalised capture from exifr's output. Pure, so it is tested with plain
 * objects — every edge case without having to build a file that carries it.
 */
export function normalizeCapture(
  meta: Record<string, unknown> | null | undefined,
  { gps }: { gps: boolean }
): Capture {
  if (!meta) return { ...EMPTY }

  const date = meta.DateTimeOriginal ?? meta.CreateDate
  const taken_at = date instanceof Date && !isNaN(date.getTime()) ? date.toISOString() : null

  const aperture = number(meta.FNumber)
  const focal = number(meta.FocalLength)

  const exif: ExifSubset = { v: 1 }
  const orientation = number(meta.Orientation)
  if (orientation !== null && Number.isInteger(orientation) && orientation >= 1 && orientation <= 8) {
    exif.orientation = orientation
  }
  const offset = meta.OffsetTimeOriginal ?? meta.OffsetTime
  if (typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset)) exif.offset_time = offset
  const program = coded(meta.ExposureProgram, PROGRAM)
  if (program) exif.exposure_program = program
  const mode = coded(meta.ExposureMode, EXPOSURE_MODE)
  if (mode) exif.exposure_mode = mode
  const bias = ranged(number(meta.ExposureCompensation), -20, 20)
  if (bias !== null) exif.exposure_bias_ev = Math.round(bias * 100) / 100
  const metering = coded(meta.MeteringMode, METERING)
  if (metering) exif.metering_mode = metering
  const flash = number(meta.Flash)
  if (flash !== null && Number.isInteger(flash)) exif.flash_fired = (flash & 1) === 1
  const wb = coded(meta.WhiteBalance, WHITE_BALANCE)
  if (wb) exif.white_balance = wb
  const f35 = number(meta.FocalLengthIn35mmFormat)
  if (f35 !== null && Number.isInteger(f35) && f35 >= 1 && f35 <= 5000) exif.focal_length_35mm = f35
  const lensMake = text(meta.LensMake, 64)
  if (lensMake) exif.lens_make = lensMake
  const space = coded(meta.ColorSpace, COLOR_SPACE)
  if (space) exif.color_space = space
  const software = text(meta.Software, 64)
  if (software) exif.software = software

  const lat = gps ? ranged(number(meta.latitude), -90, 90) : null
  const lon = gps ? ranged(number(meta.longitude), -180, 180) : null

  return {
    taken_at,
    camera_make: text(meta.Make, 64),
    camera_model: text(meta.Model, 64),
    lens: lensFrom(meta),
    iso: (() => {
      const iso = number(meta.ISO ?? meta.ISOSpeedRatios)
      return iso !== null && Number.isInteger(iso) ? ranged(iso, 1, 1_000_000) : null
    })(),
    aperture: aperture === null ? null : ranged(tenth(aperture), 0.5, 99.9),
    shutter: formatShutter(number(meta.ExposureTime)),
    focal_length: focal === null ? null : ranged(tenth(focal), 0.1, 9999.9),
    keywords: normalizeKeywords(meta.Keywords ?? meta.subject),
    // `{}` when nothing but the version would be there.
    exif: Object.keys(exif).length > 1 ? exif : {},
    // Both or neither: half a coordinate is not a place.
    latitude: lat !== null && lon !== null ? lat : null,
    longitude: lat !== null && lon !== null ? lon : null,
  }
}

/**
 * Reads and normalises a file's metadata. Never throws: metadata is a bonus,
 * and a file without any still uploads, exactly as before P2.
 */
export async function readCapture(buffer: Buffer, { gps }: { gps: boolean }): Promise<Capture> {
  try {
    const meta = await exifr.parse(buffer, {
      tiff: true,
      exif: true,
      gps,
      iptc: true,
      xmp: true,
      // Numbers rather than exifr's English labels, so the mapping above is
      // ours and cannot change with a library upgrade.
      translateValues: false,
      translateKeys: true,
      reviveValues: true,
      mergeOutput: true,
    })
    return normalizeCapture(meta as Record<string, unknown> | undefined, { gps })
  } catch {
    return { ...EMPTY }
  }
}
