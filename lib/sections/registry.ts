import { BASE_DEVICE, DEVICES, deviceKey, type Device } from '@/lib/sections/devices'
import { PLACEABLE } from '@/lib/sections/spots'
import { deviceValue } from '@/lib/sections/backdrop'

export { BACKDROP_KEYS } from '@/lib/sections/backdrop'

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
  /**
   * THIS SETTING CAN DIFFER BY SCREEN SIZE.
   *
   * The editor's size switcher then governs it: the panel shows what the size
   * being edited resolves to, and what is typed is stored under that size's
   * own key (`<key>_mobile`, deviceKey) rather than over the desktop's.
   *
   * Following is the default and stays the default. A narrower size stores
   * ONLY the difference — set it back to what the desktop says and the key
   * goes to null, which is "following" rather than "happens to match". That
   * is the whole reason this is a flag and not just two fields: two fields
   * cannot express "follow".
   *
   * Setting it is three things at once, and derivedDefaults does the first:
   *
   *   · storage for the twin exists, or the save action refuses the write and
   *     the photographer sees "Minified React error #441";
   *   · the renderer resolves the setting per size AND, where it costs a
   *     download, fetches only the one the current width shows;
   *   · a `live` property, if it declares one, is written under both this
   *     size's name and the other's — see `liveFor`.
   */
  device?: boolean
  /**
   * THIS FIELD'S WORDS CAN CARRY THEIR OWN TYPOGRAPHY.
   *
   * The editor puts a button under the box — alignment, typeface, size,
   * weight, spacing, color — and what is chosen is stored in the section's
   * `text` bag under this same key, NOT under the key itself. See
   * lib/sections/text-style.ts.
   *
   * Two things have to be true before it is set:
   *
   *   · the section's `defaults` contain `text: {}`, or the save action will
   *     refuse the write as a setting the section does not have;
   *   · the renderer marks the element with `editable(ctx, '<this key>')` AND
   *     writes `textStyleVars(...)` on that same element, or the choice is
   *     stored and nothing on the page changes.
   *
   * The `text` bag deliberately has no field of its own, which is what makes
   * it survive a change of look: `splitSettings` counts a key with no field
   * behind it as the photographer's. That is the decision — somebody who spent
   * ten minutes on a title's letter spacing does not lose it to one click.
   */
  textStyle?: boolean
  /**
   * THIS PIECE OF TEXT IS DRAWN AS A BUTTON.
   *
   * Adds the box to its typography panel — roundness, the gap round the words,
   * border thickness and colour, and the two hover colours. Stored in the same
   * `text` bag as everything else there, so it is per size, silent until
   * chosen, and survives a change of look on the same terms.
   *
   * Declared rather than guessed from the key's name: whether something is
   * drawn as a button is a fact about the renderer, and a panel that inferred
   * it from `cta_label` would quietly stop working the day a section called
   * its button something else.
   *
   * The renderer's side of it: the element's stylesheet must read the
   * `--txt-radius`, `--txt-pad-*`, `--txt-border-*` and `--txt-hover-*`
   * properties, each in front of whatever it said before, or these are seven
   * more controls that do nothing.
   */
  button?: boolean
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
    /**
     * A choice from a short list.
     *
     * `icons` draws it as a row of buttons instead of a drop-down, naming each
     * on hover. Worth it where the options are FEW and each has a picture that
     * says it faster than its name does — a photograph, a video, a color. A
     * drop-down hides every option but one and costs two clicks to see them; a
     * row of three says what is available without being opened.
     *
     * Not for long lists, and not for options a picture cannot carry. Fifteen
     * mystery glyphs is worse than a list of words.
     */
    | { kind: 'select'; options: { value: string; label: string; icon?: string }[]; icons?: boolean }
    | { kind: 'image' }
    /** A color picker. Stored as a #rrggbb hex, validated on save. */
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

/**
 * THE WORDS LAID OVER AN OPENING
 * ══════════════════════════════
 *
 * Every hero has these, whatever is behind them. Written once and spread into
 * each, so a change to how the title works cannot reach one hero and miss
 * another — which is the failure mode a shared block invites and the reason
 * this is not copied twice.
 */
const HERO_COPY_DEFAULTS: SectionSettings = {
  /*
   * This section's own typography (lib/type-styles.ts), as a whole — one
   * setting for every heading in it at once.
   *
   * NO LONGER EDITABLE. Per-element typography replaced it on 2026-09-27: a
   * control for "every heading in this section" is the wrong grain when each
   * heading has its own button under its own box. The key stays and is still
   * READ — rule 1, and a site that set one would otherwise change appearance
   * the day the control went away.
   */
  type: null,
  /*
   * Typography for INDIVIDUAL pieces of text, keyed by the field they belong
   * to (lib/sections/text-style.ts). No field declares it, on purpose — that
   * is what carries it across a change of look. See `textStyle` on FieldBase.
   */
  text: {},
  title: null,
  subtitle: null,
  cta_label: null,
  cta_href: null,
  /*
   * Where each piece of copy sits, out of fifteen places. All three start
   * where the old single block sat, so a hero nobody touches looks exactly as
   * it did. See lib/sections/spots.ts.
   */
  title_spot: 'bottom-center',
  subtitle_spot: 'bottom-center',
  cta_spot: 'bottom-center',
  /** Retired. Kept because rows carry it — rule 1. */
  kicker: null,
}

const HERO_COPY_FIELDS: Field[] = [
  { key: 'title', label: 'Title', kind: 'text', content: true, textStyle: true },
  { key: 'subtitle', label: 'Sub-heading', kind: 'text', content: true, textStyle: true },
  {
    key: 'cta_label',
    label: 'Button',
    kind: 'text',
    group: 'Button',
    content: true,
    textStyle: true,
    button: true,
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
]

export const SECTIONS: Record<string, SectionDef> = {
  /*
   * ONE OPENING, ONE BLOCK — AND A SECOND BLOCK FOR A SEQUENCE
   * ══════════════════════════════════════════════════════════
   *
   * There used to be a single Hero with a "What the hero shows" switch, and
   * choosing between a standing photograph and a run of featured stories
   * changed half the panel underneath it. Two thirds of the settings were
   * always irrelevant and there was nothing on screen saying which two
   * thirds, so the panel read as a pile of options rather than as one thing
   * you were making.
   *
   * They are two blocks now. You pick the one you want from the picker, and
   * everything in its panel applies to it. The cost is that switching from
   * one to the other means swapping the block — which is why the hero is no
   * longer `permanent`.
   *
   * This is the shape every future block follows: a block is a thing with its
   * own settings, not a mode of a bigger thing.
   */
  hero: {
    type: 'hero',
    label: 'Hero',
    blurb: 'The full-height opening: a photograph, a video or a color, with your words over it.',
    family: 'Opening',
    version: 1,
    singleton: true,
    styled: 'hero',
    defaults: {
      ...HERO_COPY_DEFAULTS,
      /*
       * What is behind the words. Three sources rather than three section
       * types, because they are interchangeable: the words, their places and
       * their typography mean the same thing over all of them, and swapping a
       * photograph for a color should not mean rebuilding the hero.
       *
       * PER SIZE, like everything else here — a film that carries a wide
       * screen can be the wrong thing entirely on a phone, and it is the one
       * backdrop that costs a visitor real bandwidth. The phone follows the
       * desktop until it is given a backdrop of its own; see BACKDROP_KEYS.
       */
      backdrop: 'image',
      image_path: null,
      focal: {},
      video_path: null,
      video_poster: null,
      backdrop_color: '#14100e',
      /** How much the backdrop is darkened, so words stay readable on it. */
      dim: 0,
      /**
       * Retired: this is the standing hero now, and the sequence is its own
       * block. Kept because rows carry it, and READ once — lib/sections/load.ts
       * uses it to send an old stories hero to the new block.
       */
      mode: 'fixed',
    },
    fields: [
      {
        key: 'backdrop',
        label: 'Background Type',
        kind: 'select',
        icons: true,
        device: true,
        /*
         * Painted at once, as far as it honestly can be.
         *
         * Choosing `color` needs nothing fetched, so CSS can hide the media
         * the instant the attribute changes and the answer is complete. Going
         * the other way — to a photograph or a film — adds an element that is
         * not in the page yet, which no attribute can express, so that half
         * waits for the re-render. Half the switches instant and half honest
         * beats all of them slow.
         */
        live: { attr: 'data-backdrop' },
        options: [
          { value: 'image', label: 'Photograph', icon: 'image' },
          { value: 'video', label: 'Video', icon: 'video' },
          { value: 'color', label: 'Color', icon: 'color' },
        ],
      },
      {
        key: 'image_path',
        label: 'Photograph',
        kind: 'image',
        content: true,
        device: true,
        when: { key: 'backdrop', equals: 'image' },
      },
      {
        key: 'video_path',
        label: 'Video',
        kind: 'image',
        content: true,
        device: true,
        when: { key: 'backdrop', equals: 'video' },
        help: 'It plays silently and loops. Keep it short and small — every visitor downloads it.',
      },
      {
        key: 'video_poster',
        label: 'Still image',
        kind: 'image',
        content: true,
        device: true,
        when: { key: 'backdrop', equals: 'video' },
        help: 'Shown while the video loads, and instead of it for anyone who has asked for less motion.',
      },
      {
        key: 'backdrop_color',
        label: 'Color',
        kind: 'color',
        device: true,
        when: { key: 'backdrop', equals: 'color' },
        live: { var: '--hero-bg' },
      },
      {
        key: 'dim',
        label: 'Darken it',
        kind: 'number',
        slider: true,
        device: true,
        min: 0,
        max: 80,
        step: 5,
        unit: '%',
        live: { var: '--hero-dim', unit: '%' },
        help: 'Words have to be readable on top of it. Most photographs need some.',
      },
      ...HERO_COPY_FIELDS,
      {
        key: 'focal',
        label: 'Focal point',
        kind: 'custom',
        editor: 'hero-focal',
        content: true,
        // Its own group rather than falling back into Content, which put it in
        // a SECOND group of that name below Button — two headings reading
        // "Content" in one panel, which is a mistake however you explain it.
        group: 'Focal point',
        note: 'What stays in frame when the photograph is cropped.',
        when: { key: 'backdrop', equals: 'image' },
      },
    ],
  },

  'hero-sequence': {
    type: 'hero-sequence',
    label: 'Hero sequence',
    blurb: 'Your featured stories as a full-height opening, each with its own photograph.',
    family: 'Opening',
    version: 1,
    singleton: true,
    styled: 'hero',
    needs: ['posts'],
    requires: 'At least one published story with a photograph',
    defaults: {
      ...HERO_COPY_DEFAULTS,
      /**
       * Where the sequence comes from. One answer today; galleries and a
       * plain carousel of chosen photographs are the same machinery pointed
       * somewhere else, which is why this is a setting and not the block's
       * identity.
       */
      source: 'stories',
      featured_post_ids: [],
      titles: {},
      subtitles: {},
      story_focal: {},
      title_position: 'center',
      story_align: 'left',
    },
    fields: [
      {
        key: 'source',
        label: 'What it shows',
        kind: 'select',
        options: [{ value: 'stories', label: 'Featured stories' }],
        help: 'Galleries and a carousel of chosen photographs are coming here too.',
      },
      ...HERO_COPY_FIELDS,
      /*
       * The story's OWN title, laid over its own photograph — not the three
       * pieces of copy above, which belong to the section and stay put as the
       * pictures change behind them. One control appearing to serve both is
       * part of why the old hero was confusing.
       */
      { key: 'title_position', label: 'Story title position', kind: 'select', group: 'Layout',
        live: { attr: 'data-title-pos' },
        options: [
          { value: 'center', label: 'Centre' },
          { value: 'bottom', label: 'Bottom' },
        ] },
      { key: 'story_align', label: 'Story text', kind: 'select', group: 'Layout', options: ALIGN },
      {
        key: 'featured_post_ids',
        label: 'Featured stories',
        kind: 'custom',
        editor: 'hero-stories',
        content: true,
        group: 'Stories',
        note: 'Choosing stories, their hero titles and where each photograph is cropped.',
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
      /*
       * This section's own typography (lib/type-styles.ts), as a whole — one
       * setting for every heading in it at once.
       *
       * NO LONGER EDITABLE. Per-element typography replaced it on 2026-09-27:
       * a control for "every heading in this section" is the wrong grain when
       * each heading has its own button under its own box, and two controls
       * over the same numbers with nothing saying which is which is worse
       * than one.
       *
       * The key stays and is still READ — rule 1, and a site that set one
       * would otherwise change appearance the day the control went away. The
       * inspector offers to clear it where one exists, and once cleared there
       * is no way back to it.
       */
      type: null,
      /* Typography for individual pieces of text, keyed by the field they
         belong to. No field declares it, which is what carries it across a
         change of look. See `textStyle` on FieldBase. */
      text: {},
      kicker: null,
      heading: null,
      body: null,
      image_path: null,
      image_side: 'left',
    },
    fields: [
      { key: 'kicker', label: 'Over-line', kind: 'text', content: true, textStyle: true, help: 'The small line above the heading.' },
      { key: 'heading', label: 'Heading', kind: 'text', content: true, textStyle: true },
      {
        key: 'body',
        label: 'Text',
        kind: 'textarea',
        rows: 6,
        content: true,
        textStyle: true,
        help: 'Leave a blank line between paragraphs.',
      },
      { key: 'image_path', label: 'Photograph', kind: 'image', content: true },
      { key: 'image_side', label: 'Layout', kind: 'select', options: SIDE, live: { attr: 'data-side' } },
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
      /*
       * This section's own typography (lib/type-styles.ts), as a whole — one
       * setting for every heading in it at once.
       *
       * NO LONGER EDITABLE. Per-element typography replaced it on 2026-09-27:
       * a control for "every heading in this section" is the wrong grain when
       * each heading has its own button under its own box, and two controls
       * over the same numbers with nothing saying which is which is worse
       * than one.
       *
       * The key stays and is still READ — rule 1, and a site that set one
       * would otherwise change appearance the day the control went away. The
       * inspector offers to clear it where one exists, and once cleared there
       * is no way back to it.
       */
      type: null,
      /* Typography for individual pieces of text, keyed by the field they
         belong to. No field declares it, which is what carries it across a
         change of look. See `textStyle` on FieldBase. */
      text: {},
      eyebrow: null,
      heading: null,
      body: null,
      image_path: null,
      image_side: 'left',
      cta_label: null,
      cta_href: null,
    },
    fields: [
      { key: 'eyebrow', label: 'Over-line', kind: 'text', content: true, textStyle: true, help: 'The small line above the heading.' },
      { key: 'heading', label: 'Heading', kind: 'text', content: true, textStyle: true },
      {
        key: 'body',
        label: 'Text',
        kind: 'textarea',
        rows: 8,
        content: true,
        textStyle: true,
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
        textStyle: true,
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
      /*
       * This section's own typography (lib/type-styles.ts), as a whole — one
       * setting for every heading in it at once.
       *
       * NO LONGER EDITABLE. Per-element typography replaced it on 2026-09-27:
       * a control for "every heading in this section" is the wrong grain when
       * each heading has its own button under its own box, and two controls
       * over the same numbers with nothing saying which is which is worse
       * than one.
       *
       * The key stays and is still READ — rule 1, and a site that set one
       * would otherwise change appearance the day the control went away. The
       * inspector offers to clear it where one exists, and once cleared there
       * is no way back to it.
       */
      type: null,
      // 'carousel': the homepage's draggable row.
      // 'grid': every gallery as a tile, under a page heading (the Galleries
      // page's layout).
      /* Typography for individual pieces of text, keyed by the field they
         belong to. No field declares it, which is what carries it across a
         change of look. See `textStyle` on FieldBase. */
      text: {},
      layout: 'carousel',
      eyebrow: null,
      heading: 'Recent trips',
      limit: 0,
      /*
       * Across, on a wide screen; narrower screens step down on their own.
       *
       * A STRING, because the field below is a `select` whose options are
       * '2', '3' and '4'. It was the number 3 until 2026-09-29, which meant a
       * section nobody had opened carried a number and a section saved once
       * carried a string, for the same setting. Both drew correctly — every
       * renderer reads it through `num(settings, …)` rather than comparing
       * it — so nothing was visibly wrong, and nothing would have been until
       * the first renderer compared it.
       */
      columns: '3',
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
        textStyle: true,
        when: { key: 'layout', equals: 'grid' },
      },
      { key: 'heading', label: 'Heading', kind: 'text', content: true, textStyle: true },
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
      /*
       * This section's own typography (lib/type-styles.ts), as a whole — one
       * setting for every heading in it at once.
       *
       * NO LONGER EDITABLE. Per-element typography replaced it on 2026-09-27:
       * a control for "every heading in this section" is the wrong grain when
       * each heading has its own button under its own box, and two controls
       * over the same numbers with nothing saying which is which is worse
       * than one.
       *
       * The key stays and is still READ — rule 1, and a site that set one
       * would otherwise change appearance the day the control went away. The
       * inspector offers to clear it where one exists, and once cleared there
       * is no way back to it.
       */
      type: null,
      // 'row': the latest few, with a link to the rest (the homepage's).
      // 'grid': every story, the newest drawn large (the Journal page's).
      /* Typography for individual pieces of text, keyed by the field they
         belong to. No field declares it, which is what carries it across a
         change of look. See `textStyle` on FieldBase. */
      text: {},
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
      // A STRING, for the same reason as `galleries.columns` above: the field
      // is a `select` of '2' and '3'.
      grid_columns: '3',
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
        textStyle: true,
        when: { key: 'layout', equals: 'grid' },
      },
      { key: 'heading', label: 'Heading', kind: 'text', content: true, textStyle: true },
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
        textStyle: true,
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
      /*
       * This section's own typography (lib/type-styles.ts), as a whole — one
       * setting for every heading in it at once.
       *
       * NO LONGER EDITABLE. Per-element typography replaced it on 2026-09-27:
       * a control for "every heading in this section" is the wrong grain when
       * each heading has its own button under its own box, and two controls
       * over the same numbers with nothing saying which is which is worse
       * than one.
       *
       * The key stays and is still READ — rule 1, and a site that set one
       * would otherwise change appearance the day the control went away. The
       * inspector offers to clear it where one exists, and once cleared there
       * is no way back to it.
       */
      type: null,
      /* Typography for individual pieces of text, keyed by the field they
         belong to. No field declares it, which is what carries it across a
         change of look. See `textStyle` on FieldBase. */
      text: {},
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
      { key: 'eyebrow', label: 'Line above the title', kind: 'text', content: true, textStyle: true },
      { key: 'heading', label: 'Title', kind: 'text', content: true, textStyle: true },
      { key: 'subheading', label: 'Line below the title', kind: 'text', content: true, textStyle: true },
      {
        key: 'intro',
        label: 'Intro',
        kind: 'textarea',
        rows: 3,
        content: true,
        textStyle: true,
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
        // No group of its own: "The wall" held this one field, so it drew a
        // heading, a fold arrow and a count of 1 over a single slider — the
        // same thing that made "Section" read as empty on the hero. A group
        // earns its heading by having something to group.
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
      /* Typography for individual pieces of text, keyed by the field they
         belong to. No field declares it, which is what carries it across a
         change of look. See `textStyle` on FieldBase. */
      text: {},
      heading: null,
      count: 9,
    },
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', content: true, textStyle: true },
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
      /*
       * This section's own typography (lib/type-styles.ts), as a whole — one
       * setting for every heading in it at once.
       *
       * NO LONGER EDITABLE. Per-element typography replaced it on 2026-09-27:
       * a control for "every heading in this section" is the wrong grain when
       * each heading has its own button under its own box, and two controls
       * over the same numbers with nothing saying which is which is worse
       * than one.
       *
       * The key stays and is still READ — rule 1, and a site that set one
       * would otherwise change appearance the day the control went away. The
       * inspector offers to clear it where one exists, and once cleared there
       * is no way back to it.
       */
      type: null,
      // 'split': photograph beside the form (the homepage's).
      // 'centered': the form and its words in the middle, no photograph (the
      // Contact page's). The first of the per-section layouts; more options
      // per section are planned — see claude/the-canvas.md.
      /* Typography for individual pieces of text, keyed by the field they
         belong to. No field declares it, which is what carries it across a
         change of look. See `textStyle` on FieldBase. */
      text: {},
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
      { key: 'eyebrow', label: 'Over-line', kind: 'text', content: true, textStyle: true },
      { key: 'heading', label: 'Heading', kind: 'text', content: true, textStyle: true },
      { key: 'intro', label: 'Text', kind: 'textarea', rows: 4, content: true, textStyle: true },
      {
        key: 'note',
        label: 'Small print',
        kind: 'text',
        content: true,
        textStyle: true,
        help: 'Under the links — response times, where you are.',
      },
      {
        key: 'tagline',
        label: 'Caption over the photograph',
        kind: 'text',
        content: true,
        textStyle: true,
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
      { value: 'page', label: 'Page color' },
      { value: 'alt', label: 'Alternate color' },
      { value: 'tint', label: 'A tint of the accent' },
      { value: 'custom', label: 'A color of my own' },
      { value: 'image', label: 'A photograph' },
    ],
    group: 'Section',
    live: { attr: 'data-bg' },
    help: 'The page and alternate colors follow your palette in Style mode.',
  },
  {
    key: 'bg_color',
    label: 'Color',
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
    help: 'A photograph does not change the text color on its own, and the site’s ink is usually too dark to read on one.',
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
  /*
   * ITS OWN GROUP, not "Section".
   *
   * On the hero this was the only common field — spacing and a background
   * have nothing to act on behind a full-bleed photograph — so "Section" drew
   * a heading, a fold arrow and a count of 1 over a single select, and read
   * as a group with nothing in it. Renaming the whole group to Visibility
   * would have been wrong everywhere else, where it also holds spacing,
   * background and width. Splitting is what both of them wanted.
   */
  group: 'Visibility',
  folded: true,
  live: { attr: 'data-hide' },
}

for (const def of Object.values(SECTIONS)) {
  def.defaults = { ...def.defaults, ...COMMON_DEFAULTS, ...derivedDefaults(def) }
  // The hero is full-bleed and draws its own photograph edge to edge: spacing
  // and a background color have nothing to act on.
  def.fields = [...def.fields, ...(def.type === 'hero' ? [] : [...SPACING_FIELDS, VISIBILITY_FIELD])]
}

/**
 * THE KEYS A PANEL WRITES THAT NO FIELD DECLARES.
 *
 * `updateDraftSectionValues` refuses any key that is not in the section's
 * defaults, which is rule 4 doing its job — a renderer may only read keys that
 * exist, and the same discipline keeps a typo out of the database. But three
 * things the editor writes have no field behind them, on purpose, because that
 * is what carries them across a change of look: the per-element typography
 * bags, the per-element visibility bag, and each placement's phone value.
 *
 * Hand-writing them in every section is how they went missing. The first
 * release of per-device typography declared `text` and forgot `text_mobile`,
 * so styling anything on a phone threw inside the server action — and Next
 * redacts a server action's message in production, so what a photographer saw
 * was "Minified React error #441" and nothing else.
 *
 * Deriving them from the same declarations the panel reads means the two
 * cannot disagree. Add a device to lib/sections/devices.ts, or `textStyle` to
 * a field, and the storage for it exists.
 */
function derivedDefaults(def: SectionDef): SectionSettings {
  const out: SectionSettings = {}

  if (def.fields.some((f) => f.textStyle)) {
    // Typography per piece of text, per size. The base device keeps the plain
    // key so every row already in the database is a desktop row.
    for (const device of DEVICES) out[deviceKey('text', device)] = {}
    // Which sizes each piece appears on.
    out.shown = {}
  }

  /*
   * Placements. PLACEABLE is the list — a placement stopped being a field of
   * its own when it became one of the three things the Customize panel does
   * to a piece of text, and the drag has always read it from there.
   */
  for (const { key } of PLACEABLE) {
    if (!(key in def.defaults)) continue
    for (const device of DEVICES) {
      if (device === BASE_DEVICE) continue
      // NULL, not a place: null means "still following the desktop", and a
      // place means "deliberately somewhere else". A default of
      // 'bottom-center' would make the two indistinguishable.
      out[deviceKey(key, device)] = null
    }
  }

  /*
   * And every field that says it can differ by size, on the same terms. Null
   * is "following", not "none".
   *
   * Read off the `device` flag rather than a list kept beside it: a list is a
   * second place to remember, and the one thing this whole function exists to
   * stop is the panel writing a key the save action has never heard of.
   */
  for (const field of def.fields) {
    if (!field.device) continue
    for (const device of DEVICES) {
      if (device === BASE_DEVICE) continue
      out[deviceKey(field.key, device)] = null
    }
  }

  return out
}

/**
 * A SECTION'S SETTINGS AS ONE SIZE SEES THEM.
 *
 * Every per-device field replaced by what this size actually resolves to,
 * under its PLAIN key — so the panel, its `when` conditions and the form read
 * all go on working in one vocabulary and only two places have to know that a
 * phone twin exists: this, and where the value is written back.
 *
 * On the base device it is the settings themselves.
 */
export function deviceView(
  def: SectionDef,
  settings: SectionSettings,
  device: Device
): SectionSettings {
  if (device === BASE_DEVICE) return settings
  const out = { ...settings }
  for (const field of def.fields) {
    if (!field.device) continue
    out[field.key] = deviceValue(settings, field.key, device)
  }
  return out
}

/**
 * WHICH PROPERTY A LIVE CHANGE WRITES, FOR THE SIZE BEING EDITED.
 *
 * An inline style attribute cannot carry a media query, so an element that
 * can look different on a phone carries BOTH values at once under two names
 * and one rule in the stylesheet picks between them at the breakpoint. The
 * same rule the per-element typography uses (`--txtd-` / `--txtm-`), for the
 * same reason: deciding here which one applies would be a second copy of the
 * breakpoint, free to disagree with the first.
 *
 * `--hero-dim` becomes `--hero-dim-d` and `--hero-dim-m`. An attribute needs
 * no such trick to be read by a media query, so the desktop keeps the plain
 * name it already had and only the phone takes a suffix.
 */
export function liveFor(field: Field, device: Device): LiveSpec | undefined {
  if (!field.live) return undefined
  if (!field.device) return field.live
  if ('var' in field.live) {
    return { ...field.live, var: `${field.live.var}-${device === BASE_DEVICE ? 'd' : 'm'}` }
  }
  return device === BASE_DEVICE ? field.live : { attr: `${field.live.attr}-m` }
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
