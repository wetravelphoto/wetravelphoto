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

/**
 * How the editor can show a change on the page AS IT IS MADE, before the save
 * and the re-render come back.
 *
 * The rule is the same one the text patch follows: the preview may only do
 * what the server is about to do anyway. So a field declares the ONE thing its
 * value changes in the markup — a CSS custom property or a data attribute —
 * and its renderer writes exactly that, on an element tagged with
 * `live(ctx, [key])` from lib/sections/editable.ts. The preview then sets the
 * same property to the same value, and the re-render that follows lands on
 * what is already there.
 *
 * A setting whose effect is more than one property (it adds or removes
 * elements, changes text, picks a different image) must NOT declare this. It
 * waits for the re-render, which is correct if slower.
 */
export type LiveSpec =
  | { var: `--${string}`; unit?: string }
  | { attr: `data-${string}` }

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'toggle'
  | 'number'
  | 'select'
  | 'image'
  | 'color'
  | 'custom'

type FieldBase = {
  key: string
  label: string
  /** One line under the input. Say what it does, not what it is. */
  help?: string
  /** Groups fields under a sub-heading in the panel. */
  group?: string
  /**
   * Show this field only when another setting has a given value — or, as a
   * list, only when every one of them does.
   */
  when?: When | When[]
  /** Its group starts folded in the editor's panel. */
  folded?: boolean
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
  /** Shown on the page instantly while it changes. See LiveSpec. */
  live?: LiveSpec
}

type When = { key: string; equals: unknown }

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
    /** A colour picker. Stored as a #rrggbb hex, validated on save. */
    | { kind: 'color' }
    /**
     * Needs a purpose-built editor (a focal-point picker, a story chooser).
     * The panel shows a link to `editor` instead of an input, and the generic
     * save action leaves the key alone.
     */
    | { kind: 'custom'; editor: string; note: string }
  )

/** Data a section needs fetched before it can render. */
export type SectionNeed = 'posts' | 'albums' | 'instagram' | 'catalog'

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
  /**
   * On a full-height page (`fill` in lib/sections/pages.ts), this section
   * takes up the spare height — its renderer's root has `flex: 1`. Declared so
   * the preview's per-section wrapper can pass the growth through; without it
   * the wrapper would sit between the page column and the section and the
   * preview would lay out shorter than the live page.
   */
  grows?: boolean
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
      // This section's own typography (lib/type-styles.ts). Null follows the site.
      type: null,
      mode: 'stories',
      title_position: 'center',
      story_align: 'left',
      // Where each piece of copy sits on the photograph, out of nine places.
      // All three start where the old single block sat, so a hero nobody
      // touches looks exactly as it did. See lib/sections/spots.ts.
      title_spot: 'bottom-center',
      subtitle_spot: 'bottom-center',
      cta_spot: 'bottom-center',
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
      /*
       * Still here, and only for the stories hero: HomeHero lays a featured
       * story's own title over its picture, and this is where that sits. It
       * has nothing to do with the standing hero's three places below, which
       * is part of why one control appearing to serve both was so confusing.
       */
      { key: 'title_position', label: 'Story title position', kind: 'select', group: 'Layout',
        live: { attr: 'data-title-pos' },
        when: { key: 'mode', equals: 'stories' },
        options: [
          { value: 'center', label: 'Centre' },
          { value: 'bottom', label: 'Bottom' },
        ] },
      { key: 'story_align', label: 'Story text', kind: 'select', group: 'Layout', options: ALIGN,
        live: { attr: 'data-story-align' }, when: { key: 'mode', equals: 'stories' } },
      /*
       * THREE PLACES, NOT ONE POSITION.
       *
       * There was a single "Title position" select here offering Centre and
       * Bottom. It moved the wordmark and left the copy where it was, because
       * the title, subtitle and button were one block welded to the bottom of
       * the picture. Reported, correctly, as "you select center and only the
       * page title goes to the center, everything stays in the bottom".
       *
       * Each now names its own place out of nine. Design rather than content:
       * a look may move them, and switching look does not carry them across —
       * unlike the words themselves, which are the photographer's.
       */
      {
        key: 'title_spot',
        label: 'Title',
        kind: 'custom',
        editor: 'spot',
        group: 'Placement',
        note: 'Where the title sits on the photograph.',
      },
      {
        key: 'subtitle_spot',
        label: 'Subtitle',
        kind: 'custom',
        editor: 'spot',
        group: 'Placement',
        note: 'Where the line under the title sits.',
      },
      {
        key: 'cta_spot',
        label: 'Button',
        kind: 'custom',
        editor: 'spot',
        group: 'Placement',
        note: 'Where the button sits. Only shown when the button has a label and a link.',
      },
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
      {
        key: 'type',
        label: 'Typography',
        kind: 'custom',
        editor: 'typography',
        group: 'Typography',
        folded: true,
        note: 'The typefaces, colours and sizes of this section only.',
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
      { key: 'align', label: 'Position', kind: 'select', options: POSITION, live: { attr: 'data-align' } },
      {
        key: 'size',
        label: 'Size',
        kind: 'number',
        min: 24,
        max: 240,
        step: 2,
        slider: true,
        unit: 'px',
        live: { var: '--mark-size', unit: 'px' },
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
      // This section's own typography (lib/type-styles.ts). Null follows the site.
      type: null,
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
      { key: 'image_side', label: 'Layout', kind: 'select', options: SIDE, live: { attr: 'data-side' } },
      {
        key: 'type',
        label: 'Typography',
        kind: 'custom',
        editor: 'typography',
        group: 'Typography',
        folded: true,
        note: 'The typefaces, colours and sizes of this section only.',
      },
    ],
  },

  about: {
    type: 'about',
    label: 'About',
    blurb: 'A photograph beside your story, full height — the heart of an About page.',
    family: 'Words',
    version: 1,
    styled: 'intro',
    grows: true,
    defaults: {
      // This section's own typography (lib/type-styles.ts). Null follows the site.
      type: null,
      eyebrow: null,
      heading: null,
      body: null,
      image_path: null,
      image_side: 'left',
      cta_label: null,
      cta_href: null,
    },
    fields: [
      { key: 'eyebrow', label: 'Over-line', kind: 'text', content: true, help: 'The small line above the heading.' },
      { key: 'heading', label: 'Heading', kind: 'text', content: true },
      {
        key: 'body',
        label: 'Text',
        kind: 'textarea',
        rows: 8,
        content: true,
        help: 'Leave a blank line between paragraphs.',
      },
      { key: 'image_path', label: 'Photograph', kind: 'image', content: true },
      { key: 'image_side', label: 'Layout', kind: 'select', options: SIDE, live: { attr: 'data-side' } },
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
      {
        key: 'type',
        label: 'Typography',
        kind: 'custom',
        editor: 'typography',
        group: 'Typography',
        folded: true,
        note: 'The typefaces, colours and sizes of this section only.',
      },
    ],
  },

  galleries: {
    type: 'galleries',
    label: 'Gallery carousel',
    blurb: 'Your public galleries — a row of covers to drag sideways, or the full grid of them.',
    family: 'Photographs',
    version: 1,
    styled: 'intro',
    needs: ['albums'],
    requires: 'At least one public gallery with a cover photograph',
    // Only the grid's root has flex: 1 (it is the Galleries page's layout).
    grows: true,
    defaults: {
      // This section's own typography (lib/type-styles.ts). Null follows the site.
      type: null,
      // 'carousel': the homepage's draggable row.
      // 'grid': every gallery as a tile, under a page heading (the Galleries
      // page's layout).
      layout: 'carousel',
      eyebrow: null,
      heading: 'Recent trips',
      limit: 0,
      // Across, on a wide screen; narrower screens step down on their own.
      columns: 3,
    },
    fields: [
      {
        key: 'layout',
        label: 'Layout',
        kind: 'select',
        options: [
          { value: 'carousel', label: 'A row you drag sideways' },
          { value: 'grid', label: 'A grid of every gallery' },
        ],
      },
      {
        key: 'eyebrow',
        label: 'Over-line',
        kind: 'text',
        content: true,
        when: { key: 'layout', equals: 'grid' },
      },
      { key: 'heading', label: 'Heading', kind: 'text', content: true },
      {
        key: 'limit',
        label: 'How many',
        kind: 'number',
        min: 0,
        max: 24,
        help: '0 shows every public gallery.',
      },
      {
        key: 'columns',
        label: 'Galleries across',
        kind: 'select',
        options: [
          { value: '2', label: 'Two' },
          { value: '3', label: 'Three' },
          { value: '4', label: 'Four' },
        ],
        help: 'On a wide screen. Narrower screens step down on their own.',
        live: { attr: 'data-cols' },
        when: { key: 'layout', equals: 'grid' },
      },
      {
        key: 'type',
        label: 'Typography',
        kind: 'custom',
        editor: 'typography',
        group: 'Typography',
        folded: true,
        note: 'The typefaces, colours and sizes of this section only.',
      },
    ],
  },

  journal: {
    type: 'journal',
    label: 'Journal',
    blurb: 'Your stories as cards — the latest few with a link through, or every one of them.',
    family: 'Words',
    version: 1,
    styled: 'journal',
    needs: ['posts'],
    requires: 'At least one published story',
    // Only the grid's root has flex: 1 (it is the Journal page's layout).
    grows: true,
    defaults: {
      // This section's own typography (lib/type-styles.ts). Null follows the site.
      type: null,
      // 'row': the latest few, with a link to the rest (the homepage's).
      // 'grid': every story, the newest drawn large (the Journal page's).
      layout: 'row',
      eyebrow: null,
      heading: 'From the journal',
      count: 3,
      cta_label: 'View all stories',
      show_excerpt: true,
      show_date: false,
      show_byline: false,
      title_scale: 1,
      // How the grid is arranged: 'feature' (the newest drawn large, the rest
      // flowing after it), 'single' (one wide column, every story large) or
      // 'columns' (even columns, every story the same size).
      grid_style: 'feature',
      grid_columns: 3,
    },
    fields: [
      {
        key: 'layout',
        label: 'Layout',
        kind: 'select',
        options: [
          { value: 'row', label: 'The latest few, with a link' },
          { value: 'grid', label: 'Every story, newest first' },
        ],
      },
      {
        key: 'eyebrow',
        label: 'Over-line',
        kind: 'text',
        content: true,
        when: { key: 'layout', equals: 'grid' },
      },
      { key: 'heading', label: 'Heading', kind: 'text', content: true },
      {
        key: 'count',
        label: 'How many stories',
        kind: 'number',
        min: 1,
        max: 12,
        when: { key: 'layout', equals: 'row' },
      },
      {
        key: 'cta_label',
        label: 'Link',
        kind: 'text',
        content: true,
        help: 'Leave empty to hide it.',
        when: { key: 'layout', equals: 'row' },
      },
      {
        key: 'grid_style',
        label: 'Arrangement',
        kind: 'select',
        options: [
          { value: 'feature', label: 'Newest large, the rest flowing after' },
          { value: 'single', label: 'One wide column' },
          { value: 'columns', label: 'Even columns' },
        ],
        when: { key: 'layout', equals: 'grid' },
      },
      {
        key: 'grid_columns',
        label: 'Columns',
        kind: 'select',
        options: [
          { value: '2', label: 'Two' },
          { value: '3', label: 'Three' },
        ],
        live: { attr: 'data-cols' },
        when: [
          { key: 'layout', equals: 'grid' },
          { key: 'grid_style', equals: 'columns' },
        ],
      },
      {
        key: 'show_excerpt',
        label: 'Show the excerpt',
        kind: 'toggle',
        group: 'Cards',
        when: { key: 'layout', equals: 'grid' },
      },
      {
        key: 'show_date',
        label: 'Show the date',
        kind: 'toggle',
        group: 'Cards',
        when: { key: 'layout', equals: 'grid' },
      },
      {
        key: 'show_byline',
        label: 'Show the byline',
        kind: 'toggle',
        group: 'Cards',
        when: { key: 'layout', equals: 'grid' },
      },
      {
        key: 'title_scale',
        label: 'Title size',
        kind: 'number',
        min: 0.7,
        max: 1.6,
        step: 0.05,
        slider: true,
        unit: '×',
        group: 'Cards',
        live: { var: '--journal-title-scale' },
        when: { key: 'layout', equals: 'grid' },
      },
      {
        key: 'type',
        label: 'Typography',
        kind: 'custom',
        editor: 'typography',
        group: 'Typography',
        folded: true,
        note: 'The typefaces, colours and sizes of this section only.',
      },
    ],
  },

  shop: {
    type: 'shop',
    label: 'Print wall',
    blurb: 'Your prints hung on a wall in even columns, with the shop’s title and categories above.',
    family: 'Shop',
    version: 1,
    singleton: true,
    grows: true,
    needs: ['catalog'],
    requires: 'The shop switched on, with prints published in the catalogue',
    defaults: {
      // This section's own typography (lib/type-styles.ts). Null follows the site.
      type: null,
      eyebrow: null,
      heading: 'Prints',
      subheading: null,
      intro: null,
      columns: 3,
      show_location: true,
      show_collection: true,
      show_price: true,
    },
    fields: [
      { key: 'eyebrow', label: 'Line above the title', kind: 'text', content: true },
      { key: 'heading', label: 'Title', kind: 'text', content: true },
      { key: 'subheading', label: 'Line below the title', kind: 'text', content: true },
      {
        key: 'intro',
        label: 'Intro',
        kind: 'textarea',
        rows: 3,
        content: true,
        help: 'Sits under the categories, above the wall. Optional.',
      },
      {
        key: 'columns',
        label: 'Prints across',
        kind: 'number',
        min: 2,
        max: 5,
        step: 1,
        slider: true,
        group: 'The wall',
        help: 'On a wide screen. Narrower screens step down on their own.',
        live: { attr: 'data-cols' },
      },
      {
        key: 'show_location',
        label: 'Where it was taken',
        kind: 'toggle',
        group: 'Captions',
      },
      {
        key: 'show_collection',
        label: 'Collection',
        kind: 'toggle',
        group: 'Captions',
      },
      {
        key: 'show_price',
        label: 'Price',
        kind: 'toggle',
        group: 'Captions',
        help: 'The cheapest size. Off makes the shop read as a gallery.',
      },
      {
        key: 'type',
        label: 'Typography',
        kind: 'custom',
        editor: 'typography',
        group: 'Typography',
        folded: true,
        note: 'The typefaces, colours and sizes of this section only.',
      },
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
    blurb: 'An invitation to get in touch: the message form and your links, beside a photograph or centred on its own.',
    family: 'Connect',
    version: 1,
    singleton: true,
    styled: 'contact',
    // Only the centred layout has flex: 1 on its root; the split sits at its
    // natural height either way, so declaring this changes nothing for it.
    grows: true,
    defaults: {
      // This section's own typography (lib/type-styles.ts). Null follows the site.
      type: null,
      // 'split': photograph beside the form (the homepage's).
      // 'centered': the form and its words in the middle, no photograph (the
      // Contact page's). The first of the per-section layouts; more options
      // per section are planned — see claude/the-canvas.md.
      layout: 'split',
      eyebrow: null,
      heading: null,
      intro: null,
      note: null,
      tagline: null,
      image_path: null,
      image_side: 'left',
    },
    fields: [
      {
        key: 'layout',
        label: 'Layout',
        kind: 'select',
        options: [
          { value: 'split', label: 'Photograph beside the form' },
          { value: 'centered', label: 'Centred, no photograph' },
        ],
      },
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
      {
        key: 'tagline',
        label: 'Caption over the photograph',
        kind: 'text',
        content: true,
        when: { key: 'layout', equals: 'split' },
      },
      {
        key: 'image_path',
        label: 'Photograph',
        kind: 'image',
        content: true,
        when: { key: 'layout', equals: 'split' },
      },
      {
        key: 'image_side',
        label: 'Photograph side',
        kind: 'select',
        options: SIDE,
        live: { attr: 'data-side' },
        when: { key: 'layout', equals: 'split' },
      },
      {
        key: 'type',
        label: 'Typography',
        kind: 'custom',
        editor: 'typography',
        group: 'Typography',
        folded: true,
        note: 'The typefaces, colours and sizes of this section only.',
      },
    ],
  },
}

// ── What every section has ───────────────────────────────────────────────────
//
// Spacing, background and where it shows. Added to every type here rather than
// written into each one, so a new section type gets them for free and they
// cannot drift apart. None of them is content: they are design, and a new look
// may change them.
//
// They are drawn by a wrapper around each section (see PageBody and
// app/sections-common.css) as data attributes and one custom property, which
// the section's own stylesheet reads with its old value as the fallback — so a
// section left on "Default" looks exactly as it always did.

const SPACE = [
  { value: 'default', label: 'Default' },
  { value: 'none', label: 'None' },
  { value: 's', label: 'Small' },
  { value: 'm', label: 'Medium' },
  { value: 'l', label: 'Large' },
  { value: 'xl', label: 'Extra large' },
]

const COMMON_DEFAULTS: SectionSettings = {
  space_top: 'default',
  space_bottom: 'default',
  background: 'default',
  bg_color: '#f1efe9',
  bg_image: null,
  bg_position: 'center',
  bg_text: 'light',
  bg_dim: 30,
  width: 'default',
  hide_on: 'none',
}

const SPACING_FIELDS: Field[] = [
  {
    key: 'space_top',
    label: 'Space above',
    kind: 'select',
    options: SPACE,
    group: 'Section',
    folded: true,
    live: { attr: 'data-space-top' },
    help: 'The first section on a page needs room for the menu above it.',
  },
  {
    key: 'space_bottom',
    label: 'Space below',
    kind: 'select',
    options: SPACE,
    group: 'Section',
    live: { attr: 'data-space-bottom' },
  },
  {
    key: 'background',
    label: 'Background',
    kind: 'select',
    options: [
      { value: 'default', label: 'Default' },
      { value: 'page', label: 'Page colour' },
      { value: 'alt', label: 'Alternate colour' },
      { value: 'tint', label: 'A tint of the accent' },
      { value: 'custom', label: 'A colour of my own' },
      { value: 'image', label: 'A photograph' },
    ],
    group: 'Section',
    live: { attr: 'data-bg' },
    help: 'The page and alternate colours follow your palette in Style mode.',
  },
  {
    key: 'bg_color',
    label: 'Colour',
    kind: 'color',
    group: 'Section',
    live: { var: '--sec-bg-custom' },
    when: { key: 'background', equals: 'custom' },
  },
  {
    key: 'bg_image',
    label: 'Photograph',
    kind: 'image',
    group: 'Section',
    // The photographer's own picture, so switching to a different look carries
    // it across rather than replacing it. See `content` on FieldBase.
    content: true,
    when: { key: 'background', equals: 'image' },
    // Deliberately NOT `live`: a path has to be wrapped in url() before it is
    // a background, which is a transformation rather than the identity, and
    // the rule is that an instant patch must be exactly what the server is
    // about to render. It arrives with the refresh a moment later.
    help: 'Behind everything in this section, filling it.',
  },
  {
    key: 'bg_position',
    label: 'Keep in view',
    kind: 'select',
    options: [
      { value: 'center', label: 'The middle' },
      { value: 'top', label: 'The top' },
      { value: 'bottom', label: 'The bottom' },
    ],
    group: 'Section',
    when: { key: 'background', equals: 'image' },
    live: { attr: 'data-bg-pos' },
    help: 'The part that survives when the section is narrower than the photograph.',
  },
  {
    key: 'bg_text',
    label: 'Words',
    kind: 'select',
    options: [
      { value: 'light', label: 'Light, on a darkened photograph' },
      { value: 'dark', label: 'Dark, on a pale photograph' },
    ],
    group: 'Section',
    when: { key: 'background', equals: 'image' },
    live: { attr: 'data-ink' },
    help: 'A photograph does not change the text colour on its own, and the site’s ink is usually too dark to read on one.',
  },
  {
    key: 'bg_dim',
    label: 'Darken it',
    kind: 'number',
    slider: true,
    min: 0,
    max: 80,
    step: 5,
    unit: '%',
    group: 'Section',
    when: { key: 'background', equals: 'image' },
    live: { var: '--sec-bg-dim', unit: '%' },
    help: 'Words have to be readable on top of it. Most photographs need some.',
  },
  {
    key: 'width',
    label: 'Width',
    kind: 'select',
    options: [
      { value: 'default', label: 'The site’s width' },
      { value: 'narrow', label: 'Narrow — a reading column' },
      { value: 'wide', label: 'Wide' },
      { value: 'full', label: 'Edge to edge' },
    ],
    group: 'Section',
    live: { attr: 'data-width' },
    help: 'How wide the words and pictures sit. The hero and About are always edge to edge.',
  },
]

const VISIBILITY_FIELD: Field = {
  key: 'hide_on',
  label: 'Show on',
  kind: 'select',
  options: [
    { value: 'none', label: 'Every screen' },
    { value: 'mobile', label: 'Desktop and tablet only' },
    { value: 'desktop', label: 'Phones only' },
  ],
  group: 'Section',
  folded: true,
  live: { attr: 'data-hide' },
}

for (const def of Object.values(SECTIONS)) {
  def.defaults = { ...def.defaults, ...COMMON_DEFAULTS }
  // The hero is full-bleed and draws its own photograph edge to edge: spacing
  // and a background colour have nothing to act on. Where it shows still does.
  def.fields = [...def.fields, ...(def.type === 'hero' ? [VISIBILITY_FIELD] : [...SPACING_FIELDS, VISIBILITY_FIELD])]
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
  return def.fields.filter((f) => {
    if (!f.when) return true
    const rules = Array.isArray(f.when) ? f.when : [f.when]
    return rules.every((rule) => settings[rule.key] === rule.equals)
  })
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

/**
 * Every data attribute any field can set live. The preview watches these for
 * re-renders, so a live value that a stale re-render overwrote can be put back.
 */
export const LIVE_ATTRS: string[] = Array.from(
  new Set(
    Object.values(SECTIONS).flatMap((def) =>
      def.fields.flatMap((f) => (f.live && 'attr' in f.live ? [f.live.attr] : []))
    )
  )
)
