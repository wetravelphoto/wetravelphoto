import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import { SAMPLE_ALBUM_SLUG } from '@/lib/samples'

/**
 * WHAT TO DO FIRST, WORKED OUT RATHER THAN REMEMBERED
 * ═══════════════════════════════════════════════════
 *
 * The dashboard used to open with seven zeros and no verbs. A number is a
 * report on work already done; somebody who has done none needs a sentence and
 * a link, and the first thing a new site says should be what to do, not how
 * little has happened.
 *
 * **Nothing here is stored.** There is no `onboarding_step` column and no
 * "dismissed" flag, because both go wrong in the same way: the checklist and
 * the site disagree, and the checklist is the one that lies. Every step is a
 * question asked of the site itself — is there a gallery, is the design still
 * the one it arrived in — so ticking a step off is done by doing the thing,
 * and undoing it un-ticks. A photographer who deletes their only gallery gets
 * the step back, which is correct: they have no gallery.
 *
 * The cost is one small query per dashboard load. The benefit is that this can
 * never be wrong.
 *
 * **Every step goes somewhere different.** There was a "Say who you are" step
 * that opened the editor, directly above a design step that also opened the
 * editor. Two rows, one destination, so the list read as longer than the work
 * actually was. A step earns its line by sending you somewhere the others do
 * not.
 *
 * **It leaves when it is finished.** Scaffolding, not furniture: once every
 * step is done the list is gone, and the dashboard is the dashboard.
 */

export type Step = {
  id: string
  title: string
  detail: string
  href: string
  cta: string
  done: boolean
}

export type StartHere = {
  steps: Step[]
  done: number
  total: number
  /** False once there is nothing left to say. */
  show: boolean
  /**
   * The sample gallery is here but the FIRST SCREEN genuinely has no
   * photograph on it. Offered as a one-click fix rather than left as a puzzle.
   */
  homepageBare: boolean
}

/**
 * Key order survives a round trip through Postgres' jsonb unpredictably, so
 * two objects that mean the same thing can stringify differently. Sorting the
 * keys at every level makes the comparison about content and nothing else.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

export async function startHere(tenantId: string): Promise<StartHere> {
  const supabase = await createClient()
  const settings = await getSiteSettings()

  const [albums, photos, samples, hero, adopted] = await Promise.all([
    supabase
      .from('albums')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .neq('slug', SAMPLE_ALBUM_SLUG),
    supabase.from('photos').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase
      .from('albums')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('slug', SAMPLE_ALBUM_SLUG),
    supabase
      .from('page_sections')
      .select('settings')
      .eq('tenant_id', tenantId)
      .eq('page', 'home')
      .eq('type', 'hero')
      .maybeSingle(),
    // The look this site was given, kept so "have they changed it" can be
    // asked of the site rather than assumed.
    supabase.from('site_template').select('snapshot').eq('tenant_id', tenantId).maybeSingle(),
  ])

  const ownGalleries = albums.count ?? 0
  const hasPhotos = (photos.count ?? 0) > 0
  const hasSamples = (samples.count ?? 0) > 0

  // ── Is the homepage actually bare? ────────────────────────────────────────
  // Ask the SAME question the page itself asks (lib/sections/load.ts): if a
  // hero row exists, that row is the homepage; if none does, the page is being
  // rendered straight from site_settings and THAT is the homepage.
  //
  // This used to look only at page_sections. A brand-new site has no rows
  // there at all — they are not materialised until the editor is first opened
  // — so a homepage already full of photographs read as empty, and the
  // checklist offered to fill it. Asking one table about a page that is being
  // drawn from another is the same mistake that lost the photographs the first
  // time, pointing the other way.
  const heroFromSection = (hero.data?.settings as { image_path?: unknown } | null)?.image_path
  const heroImage = hero.data ? heroFromSection : settings.hero_image_path
  const homepageBare = hasSamples && !(typeof heroImage === 'string' && heroImage.trim() !== '')

  // ── Have they made the design their own? ──────────────────────────────────
  // A new site now ARRIVES wearing a look, so "have you chosen one" stopped
  // being a real question — the answer is always yes, and a step that is
  // ticked the moment it appears teaches nothing.
  //
  // The honest question is whether the design still is exactly the one they
  // were handed. Compared against the snapshot taken when the look was
  // applied, so any change made in the editor's style mode ticks it off.
  // With no snapshot to compare against — a site made before looks were
  // applied on creation — fall back to "are there any styles at all".
  const snapshot = (adopted.data?.snapshot ?? null) as {
    styles?: { tokens?: unknown; type_styles?: unknown }
  } | null

  const madeItTheirs = snapshot?.styles
    ? canonical(settings.global_styles) !== canonical(snapshot.styles.tokens ?? {}) ||
      canonical(settings.type_styles) !== canonical(snapshot.styles.type_styles ?? {})
    : Object.keys((settings.global_styles as object) ?? {}).length > 0

  const steps: Step[] = [
    {
      id: 'gallery',
      title: 'Add your first gallery',
      detail:
        'Drag in a folder of photographs. Everything else on the site has somewhere to point once there is one.',
      href: '/admin/trips/new',
      cta: 'Galleries',
      done: ownGalleries > 0 && hasPhotos,
    },
    {
      id: 'look',
      title: 'Make it look like yours',
      detail:
        'Your site came dressed in Field Notes, with starter words on it. Change the typeface, the colours and the writing until it looks like you.',
      // Straight into the editor rather than the design page: the design page
      // is a list of looks, and with one look it is a list of one. The editor
      // is where the typeface, the colours and the words actually change.
      href: '/edit/home?mode=style',
      cta: 'Open the editor',
      done: madeItTheirs,
    },
    {
      id: 'samples',
      title: 'Remove the sample photographs',
      detail:
        'The six pictures your site came with are not yours. Take them away once you have your own up.',
      href: '/admin/trips',
      cta: 'Galleries',
      done: !hasSamples,
    },
  ]

  const done = steps.filter((s) => s.done).length

  return {
    steps,
    done,
    total: steps.length,
    // Stays on screen while there is a bare homepage to fix, even if every
    // step is ticked: the offer is the point, not the tally.
    show: done < steps.length || homepageBare,
    homepageBare,
  }
}
