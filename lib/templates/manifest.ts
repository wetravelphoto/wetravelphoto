import {
  contentKeys,
  sectionDef,
  splitSettings,
  type SectionSettings,
} from '@/lib/sections/registry'

/**
 * A TEMPLATE IS DATA
 * ══════════════════
 *
 * A look — Field Notes, Salt, Atelier — is not a separate codebase or a
 * different set of components. It is this manifest: which sections a page
 * has, in what order, with which DESIGN settings, plus the site-wide type and
 * colour. Nothing in it belongs to the photographer.
 *
 * That is what makes the promise on the picker true: their photographs, words
 * and prices stay exactly where they are, because a manifest has no way to
 * express them. See `content` in lib/sections/registry.ts for the line.
 *
 * It is also what makes every commercial question answerable later instead of
 * now. A look that is a row can be versioned, retired, credited to whoever
 * made it, and — if that ever turns out to be the right thing — priced. A look
 * that is code can be none of those.
 */

/** Bump only if the manifest's own shape changes. Section settings version separately. */
export const MANIFEST_SCHEMA = 1

export type TemplateSection = {
  type: string
  visible: boolean
  /** Section-settings schema version these values were written against. */
  version: number
  /** DESIGN ONLY. Content keys here are ignored on apply — see applyManifest. */
  settings: SectionSettings
  /**
   * Starting copy for a site that has none yet. A photographer with an empty
   * site gets something to replace rather than an empty box; one who already
   * wrote their own never sees it.
   */
  demo?: SectionSettings
}

export type TemplateStyles = {
  /** Per-section typography, as lib/type-styles.ts reads it. */
  type_styles: Record<string, Record<string, unknown>>
  /**
   * The site-wide tokens — colour, typeface, measure — as
   * lib/styles/tokens.ts stores them.
   *
   * Optional because manifests written before 2026-09-16 have none, and
   * resolveTokens fills the gap. Without this half, switching looks only
   * reordered sections: Salt and Atelier came out the same colour.
   */
  tokens?: Record<string, unknown>
}

export type TemplateManifest = {
  schema: number
  pages: Record<string, TemplateSection[]>
  styles: TemplateStyles
}

/** A live section, as loadPageSections gives it. */
export type LiveSection = {
  type: string
  visible: boolean
  version: number
  settings: SectionSettings
}

export const EMPTY_MANIFEST: TemplateManifest = {
  schema: MANIFEST_SCHEMA,
  pages: {},
  styles: { type_styles: {}, tokens: {} },
}

/**
 * Turns a live site into a manifest — the design half only.
 *
 * This is how a look gets made: build it on a real site, then lift it. It is
 * also how "save my current design as a template" works, and how the bundled
 * Field Notes manifest was produced rather than hand-written.
 */
export function extractManifest(
  pages: Record<string, LiveSection[]>,
  styles: TemplateStyles
): TemplateManifest {
  const out: Record<string, TemplateSection[]> = {}

  for (const [page, sections] of Object.entries(pages)) {
    out[page] = sections
      .filter((s) => sectionDef(s.type))
      .map((s) => {
        const def = sectionDef(s.type)!
        const { design } = splitSettings(def, s.settings)

        return {
          type: s.type,
          visible: s.visible,
          version: s.version,
          settings: design,
        }
      })
  }

  return { schema: MANIFEST_SCHEMA, pages: out, styles }
}

/**
 * What applying a manifest would produce, given what is on the page now.
 *
 * Pure: it decides, it does not write. The action calls this, shows the
 * result, and only then touches the database — which is also what lets the
 * Design page say what an update would change before anyone agrees to it.
 *
 * The rule, per section in the manifest:
 *   · design settings come from the template
 *   · content settings are carried over from the section of the same type
 *     that is already on the page
 *   · a section with no counterpart takes the template's demo copy
 *   · a section on the page that the template has no slot for is KEPT, moved
 *     to the end and hidden — never deleted. Switching looks is reversible by
 *     construction, not by remembering to be careful.
 */
export type ApplyResult = {
  sections: LiveSection[]
  /** For the "here is what changes" summary. */
  summary: {
    added: string[]
    kept: string[]
    /** Kept but with nowhere to go in the new look, so parked and hidden. */
    parked: string[]
    reordered: boolean
  }
}

export function applyManifest(
  manifest: TemplateManifest,
  page: string,
  existing: LiveSection[]
): ApplyResult {
  const wanted = manifest.pages[page] ?? []

  // One existing section per type may be consumed. A page with two of the
  // same type keeps the first and parks the rest.
  const pool = new Map<string, LiveSection[]>()
  for (const s of existing) {
    const bucket = pool.get(s.type) ?? []
    bucket.push(s)
    pool.set(s.type, bucket)
  }

  const added: string[] = []
  const kept: string[] = []

  const sections: LiveSection[] = wanted.map((slot) => {
    const def = sectionDef(slot.type)
    const bucket = pool.get(slot.type)
    const match = bucket?.shift()

    if (match) kept.push(slot.type)
    else added.push(slot.type)

    // Content the photographer already wrote wins over anything the template
    // suggests. Only a section with no counterpart gets demo copy.
    const carried = match && def ? splitSettings(def, match.settings).content : (slot.demo ?? {})

    return {
      type: slot.type,
      visible: slot.visible,
      version: slot.version,
      settings: { ...slot.settings, ...carried },
    }
  })

  // Whatever the new look has no slot for goes to the end, switched off.
  const parked: string[] = []
  for (const bucket of pool.values()) {
    for (const leftover of bucket) {
      parked.push(leftover.type)
      sections.push({ ...leftover, visible: false })
    }
  }

  const before = existing.map((s) => s.type).join('>')
  const after = sections.map((s) => s.type).join('>')

  return {
    sections,
    summary: { added, kept, parked, reordered: before !== after },
  }
}

/** A plain-language list of what a manifest would do to this page. */
export function describeApply(result: ApplyResult): string[] {
  const lines: string[] = []
  const { added, parked, reordered } = result.summary
  const label = (type: string) => sectionDef(type)?.label ?? type
  const unique = (xs: string[]) => Array.from(new Set(xs))

  if (added.length) lines.push(`Adds ${unique(added).map(label).join(', ')}`)
  if (reordered) lines.push('Changes the order of the page')
  lines.push('Changes typography, colour, spacing and the look of every section')
  if (parked.length) {
    lines.push(
      `Switches off ${unique(parked).map(label).join(', ')} — kept on the page, nothing deleted`
    )
  }
  lines.push('Leaves your photographs, writing and prices exactly as they are')

  return lines
}

/**
 * Everything a section owns that this manifest would not overwrite. Used by
 * the Design page to show, honestly, what is being preserved.
 */
export function preservedKeys(type: string): string[] {
  const def = sectionDef(type)
  return def ? contentKeys(def) : []
}
