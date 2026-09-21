/**
 * THE SECTION CONTRACT
 * ════════════════════
 *
 * A page is an ordered list of sections. A section is a `type` from this
 * registry plus a bag of settings. Everything the editor knows how to do —
 * list sections, draw the add-section picker, build the settings panel,
 * coerce a submitted form, render the page — it learns from here.
 *
 * Adding the twentieth section type must not mean touching the first
 * nineteen. That holds only if these four rules hold:
 *
 *   1. NEVER REMOVE OR REPURPOSE A KEY. Rows already in the database carry
 *      it. Leave it in `defaults` and stop reading it if it is dead.
 *
 *   2. ADDING A KEY IS FREE. Put it in `defaults` and add its field. Every
 *      read merges defaults under the stored settings, so rows written
 *      before today get the new value without a database migration.
 *
 *   3. BUMP `version` ONLY WHEN AN EXISTING KEY CHANGES SHAPE OR MEANING,
 *      and write `migrate` in the same commit. Adding a key never needs it.
 *
 *   4. A RENDERER MAY ONLY READ KEYS THAT EXIST IN `defaults`. That is what
 *      makes rule 2 safe — there is no such thing as an undefined setting.
 *
 * This file is imported by both server components and client components, so
 * it stays pure data: no React, no database, no `server-only`.
 */

// ── Fields ───────────────────────────────────────────────────────────────────
// What the settings panel draws, and what tells the save action how to read
// each value back out of the form. One declaration serves both.

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'toggle'
  | 'number'
  | 'select'
  | 'image'
  | 'custom'

type FieldBase = {
  key: string
  label: string
  /** One line under the input. Say what it does, not what it is. */
  help?: string
  /** Groups fields under a sub-heading in the panel. */
  group?: string
  /** Show this field only when another setting has a given value. */
  when?: { key: string; equals: unknown }
  /**
   * CONTENT or DESIGN — the line a template is not allowed to cross.
   *
   * `content: true` means this value is the photographer's: their words,
   * their photographs, their links. Switching to a different look carries it
   * across untouched. Everything else is a design choice and comes from the
   * template.
   *
   * Get this wrong in the generous direction and a new look does nothing.
   * Get it wrong in the other direction and changing looks eats somebody's
   * writing. When it is genuinely ambiguous, call it content: keeping a value
   * that should have changed is a click to fix, losing one is not.
   */
  content?: boolean
}

export type Field = FieldBase &
  (
    | { kind: 'text'; placeholder?: string }
    | { kind: 'textarea'; rows?: number; placeholder?: string }
    | { kind: 'toggle' }
    | {
        kind: 'number'
        min?: number
        max?: number
        step?: number
        /**
         * Draw a slider with the value beside it instead of a number box. For
         * a setting that is judged by looking at it — a size — rather than
         * one that is a count.
         */
        slider?: boolean
        /** Shown after the value on a slider, e.g. 'px'. */
        unit?: string
      }
    | { kind: 'select'; options: { value: string; label: string }[] }
    | { kind: 'image' }
    /**
     * Needs a purpose-built editor (a focal-point picker, a story chooser).
     * The panel shows a link to `editor` instead of an input, and the generic
     * save action leaves the key alone.
     */
    | { kind: 'custom'; editor: string; note: string }
  )

/** Data a section needs fetched before it can render. */
export type SectionNeed = 'posts' | 'albums' | 'instagram'

export type SectionSettings = Record<string, unknown>

export type SectionDef = {
  type: string
  /** What it is called in the picker and the section list. His words. */
  label: string
  /** One sentence in the picker card. */
  blurb: string
  /** Picker grouping. */
  family: 'Opening' | 'Photographs' | 'Words' | 'Shop' | 'Connect'
  version: number
  defaults: SectionSettings
  fields: Field[]
  /** Which type_styles bucket restyles it. */
  styled?: 'hero' | 'intro' | 'journal' | 'contact'
  /** Only one allowed per page. */
  singleton?: boolean
  /** Can be hidden and moved, but not deleted. */
  permanent?: boolean
  needs?: SectionNeed[]
  /** Shown in the picker when the section has nothing to draw yet. */
  requires?: string
  /**
   * DECLARED, UNREAD. Which plan this section belongs to, once plans exist.
   * `null` or absent means everyone has it, which is every section today.
   *
   * It is here now so that adding a paid section later is a value in this
   * file rather than a schema change and a hunt through the codebase. See
   * lib/entitlements.ts for the rule about what a plan may take away.
   */
  tier?: string | null
  migrate?: (settings: SectionSettings, fromVersion: number) => SectionSettings
}

// ── The types ────────────────────────────────────────────────────────────────

const ALIGN = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
]

const POSITION = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
]

const SIDE = [
  { value: 'left', label: 'Picture on the left' },
  { value: 'right', label: 'Picture on the right' },
]

export const SECTIONS: Record<string, SectionDef> = {
  hero: {
    type: 'hero',
    label: 'Hero',
    blurb: 'The full-height opening image — one standing photograph, or your featured stories in sequence.',
    family: 'Opening',
    version: 1,
    singleton: true,
    permanent: true,
    styled: 'hero',
    needs: ['posts'],
    defaults: {
      mode: 'stories',
      title_position: 'center',
      story_align: 'left',
      show_mark: true,
      image_path: null,
      title: null,
      subtitle: null,
      cta_label: null,
      cta_href: null,
      kicker: null,
      focal: {},
      featured_post_ids: [],
      titles: {},
      subtitles: {},
      story_focal: {},
    },
    fields: [
      {
        key: 'mode',
        label: 'What the hero shows',
        kind: 'select',
        options: [
          { value: 'stories', label: 'Featured stories, in sequence' },
          { value: 'fixed', label: 'One standing photograph' },
        ],
        help: 'Stories fall back to the standing photograph when none are featured.',
      },
      {
        key: 'image_path',
        label: 'Photograph',
        kind: 'image',
        content: true,
        when: { key: 'mode', equals: 'fixed' },
      },
      { key: 'title', label: 'Title', kind: 'text', content: true },
      { key: 'subtitle', label: 'Sub-heading', kind: 'text', content: true },
      {
        key: 'cta_label',
        label: 'Button',
        kind: 'text',
        group: 'Button',
        content: true,
        help: 'Leave empty for no button.',
      },
      {
        key: 'cta_href',
        label: 'Button link',
        kind: 'text',
        group: 'Button',
        content: true,
        placeholder: '/trips',
      },
      { key: 'title_position', label: 'Title position', kind: 'select', group: 'Layout', options: [
        { value: 'center', label: 'Centre' },
        { value: 'bottom', label: 'Bottom' },
      ] },
      { key: 'story_align', label: 'Story text', kind: 'select', group: 'Layout', options: ALIGN, when: { key: 'mode', equals: 'stories' } },
      { key: 'show_mark', label: 'Show the scroll mark', kind: 'toggle', group: 'Layout' },
      {
        key: 'featured_post_ids',
        label: 'Featured stories',
        kind: 'custom',
        editor: 'hero-stories',
        content: true,
        note: 'Choosing stories, their hero titles and where each photograph is cropped.',
        when: { key: 'mode', equals: 'stories' },
      },
      {
        key: 'focal',
        label: 'Crop',
        kind: 'custom',
        editor: 'hero-focal',
        content: true,
        note: 'Dragging the focal point for desktop and phone.',
        when: { key: 'mode', equals: 'fixed' },
      },
    ],
  },

  mark: {
    type: 'mark',
    label: 'Accent mark',
    blurb: 'A small logo or emblem on a line of its own — a signature between two sections.',
    family: 'Opening',
    version: 1,
    defaults: {
      // A storage key in the site's bucket, or a path under /logos/ for a
      // mark that ships with the site. Null draws nothing in public and an
      // "add a mark" box in the editor — there is no platform-wide default,
      // because one photographer's emblem is not another's.
      image_path: null,
      align: 'center',
      size: 64,
    },
    fields: [
      {
        key: 'image_path',
        label: 'Mark',
        kind: 'custom',
        editor: 'mark-image',
        content: true,
        note: 'Upload an SVG, PNG, WebP or JPEG. Transparent backgrounds work best.',
      },
      { key: 'align', label: 'Position', kind: 'select', options: POSITION },
      {
        key: 'size',
        label: 'Size',
        kind: 'number',
        min: 24,
        max: 240,
        step: 2,
        slider: true,
        unit: 'px',
      },
    ],
  },

  intro: {
    type: 'intro',
    label: 'Introduction',
    blurb: 'A paragraph or two beside a photograph. Who you are, in your own words.',
    family: 'Words',
    version: 1,
    styled: 'intro',
    defaults: {
      kicker: null,
      heading: null,
      body: null,
      image_path: null,
      image_side: 'left',
    },
    fields: [
      { key: 'kicker', label: 'Over-line', kind: 'text', content: true, help: 'The small line above the heading.' },
      { key: 'heading', label: 'Heading', kind: 'text', content: true },
      {
        key: 'body',
        label: 'Text',
        kind: 'textarea',
        rows: 6,
        content: true,
        help: 'Leave a blank line between paragraphs.',
      },
      { key: 'image_path', label: 'Photograph', kind: 'image', content: true },
      { key: 'image_side', label: 'Layout', kind: 'select', options: SIDE },
    ],
  },

  galleries: {
    type: 'galleries',
    label: 'Gallery carousel',
    blurb: 'Your public galleries as a row of covers you can drag sideways.',
    family: 'Photographs',
    version: 1,
    styled: 'intro',
    needs: ['albums'],
    requires: 'At least one public gallery with a cover photograph',
    defaults: {
      heading: 'Recent trips',
      limit: 0,
    },
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', content: true },
      {
        key: 'limit',
        label: 'How many',
        kind: 'number',
        min: 0,
        max: 24,
        help: '0 shows every public gallery.',
      },
    ],
  },

  journal: {
    type: 'journal',
    label: 'Journal',
    blurb: 'The latest stories as cards, with a link through to everything.',
    family: 'Words',
    version: 1,
    styled: 'journal',
    needs: ['posts'],
    requires: 'At least one published story',
    defaults: {
      heading: 'From the journal',
      count: 3,
      cta_label: 'View all stories',
    },
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', content: true },
      { key: 'count', label: 'How many stories', kind: 'number', min: 1, max: 12 },
      { key: 'cta_label', label: 'Link', kind: 'text', content: true, help: 'Leave empty to hide it.' },
    ],
  },

  instagram: {
    type: 'instagram',
    label: 'Instagram',
    blurb: 'A grid of your most recent posts, pulled from your account.',
    family: 'Connect',
    version: 1,
    singleton: true,
    needs: ['instagram'],
    requires: 'Instagram connected in Settings',
    defaults: {
      heading: null,
      count: 9,
    },
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', content: true },
      { key: 'count', label: 'How many posts', kind: 'number', min: 3, max: 24, step: 3 },
    ],
  },

  contact: {
    type: 'contact',
    label: 'Contact',
    blurb: 'An invitation to get in touch, with your links and a photograph.',
    family: 'Connect',
    version: 1,
    singleton: true,
    styled: 'contact',
    defaults: {
      eyebrow: null,
      heading: null,
      intro: null,
      note: null,
      tagline: null,
      image_path: null,
      image_side: 'left',
    },
    fields: [
      { key: 'eyebrow', label: 'Over-line', kind: 'text', content: true },
      { key: 'heading', label: 'Heading', kind: 'text', content: true },
      { key: 'intro', label: 'Text', kind: 'textarea', rows: 4, content: true },
      {
        key: 'note',
        label: 'Small print',
        kind: 'text',
        content: true,
        help: 'Under the links — response times, where you are.',
      },
      { key: 'tagline', label: 'Closing line', kind: 'text', content: true },
      { key: 'image_path', label: 'Photograph', kind: 'image', content: true },
      { key: 'image_side', label: 'Layout', kind: 'select', options: SIDE },
    ],
  },
}

export const SECTION_TYPES = Object.keys(SECTIONS)

export const FAMILIES: SectionDef['family'][] = [
  'Opening',
  'Photographs',
  'Words',
  'Shop',
  'Connect',
]

export function sectionDef(type: string): SectionDef | null {
  return SECTIONS[type] ?? null
}

/**
 * The read-time guarantee, and the only way a renderer should ever see
 * settings. Defaults fill every gap, so a row written before a setting
 * existed is indistinguishable from one written today.
 */
export function resolveSettings(
  type: string,
  stored: SectionSettings | null | undefined,
  version = 1
): SectionSettings | null {
  const def = SECTIONS[type]
  if (!def) return null

  let settings = { ...(stored ?? {}) }

  if (version < def.version && def.migrate) {
    settings = def.migrate(settings, version)
  }

  return { ...def.defaults, ...settings }
}

/** Fields visible given the current values — `when` resolved. */
export function visibleFields(def: SectionDef, settings: SectionSettings): Field[] {
  return def.fields.filter((f) => !f.when || settings[f.when.key] === f.when.equals)
}

/** Keys a template must never overwrite. See `content` on FieldBase. */
export function contentKeys(def: SectionDef): string[] {
  return def.fields.filter((f) => f.content).map((f) => f.key)
}

/**
 * Splits a section's settings into the half that belongs to the photographer
 * and the half that belongs to whichever look they are using.
 *
 * A key with no field behind it — one left over from an older release, per
 * rule 1 — counts as content. Carrying a value nobody reads is harmless;
 * dropping one that turns out to matter is not.
 */
export function splitSettings(
  def: SectionDef,
  settings: SectionSettings
): { content: SectionSettings; design: SectionSettings } {
  const design = new Set(def.fields.filter((f) => !f.content).map((f) => f.key))

  const content: SectionSettings = {}
  const designValues: SectionSettings = {}

  for (const [key, value] of Object.entries(settings)) {
    if (design.has(key)) designValues[key] = value
    else content[key] = value
  }

  return { content, design: designValues }
}

/** Typed reads, so a renderer never has to cast. */
export const str = (s: SectionSettings, key: string): string | null => {
  const v = s[key]
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

export const bool = (s: SectionSettings, key: string): boolean => s[key] !== false

export const num = (s: SectionSettings, key: string, fallback: number): number => {
  const v = Number(s[key])
  return Number.isFinite(v) ? v : fallback
}

export const list = (s: SectionSettings, key: string): string[] =>
  Array.isArray(s[key]) ? (s[key] as unknown[]).filter((v): v is string => typeof v === 'string') : []

export const map = <T,>(s: SectionSettings, key: string): Record<string, T> =>
  s[key] && typeof s[key] === 'object' && !Array.isArray(s[key])
    ? (s[key] as Record<string, T>)
    : {}
