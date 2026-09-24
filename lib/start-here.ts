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
 * question asked of the site itself — is there a gallery, does the homepage
 * still say "Say who you are" — so ticking a step off is done by doing the
 * thing, and undoing it un-ticks. A photographer who deletes their only
 * gallery gets the step back, which is correct: they have no gallery.
 *
 * The cost is one small query per dashboard load. The benefit is that this can
 * never be wrong.
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
   * The sample gallery is here but the FIRST SCREEN still has no photograph
   * on it. True only for sites seeded before the homepage was part of this —
   * it is offered as a one-click fix rather than left as a puzzle.
   */
  homepageBare: boolean
}

/** The starter copy, which is what "they have not written anything yet" means. */
const STARTER_INTRO_HEADING = 'Say who you are'
const STARTER_TAGLINE = 'A line about what you photograph'

export async function startHere(tenantId: string): Promise<StartHere> {
  const supabase = await createClient()
  const settings = await getSiteSettings()

  const [albums, photos, samples, hero] = await Promise.all([
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
  ])

  const ownGalleries = albums.count ?? 0
  const hasPhotos = (photos.count ?? 0) > 0
  const hasSamples = (samples.count ?? 0) > 0

  const heroImage = (hero.data?.settings as { image_path?: unknown } | null)?.image_path
  const homepageBare =
    hasSamples && !(typeof heroImage === 'string' && heroImage.trim() !== '')

  // "Written something" means the starter words are no longer what is on the
  // page. Checking the heading AND the tagline, because changing only one is
  // usually somebody trying the editor rather than saying who they are.
  const wroteIntro =
    (settings.intro_heading ?? '') !== STARTER_INTRO_HEADING &&
    (settings.intro_heading ?? '').trim().length > 0
  const wroteTagline =
    (settings.tagline ?? '') !== STARTER_TAGLINE && (settings.tagline ?? '').trim().length > 0

  // A look has been chosen once the site's styles stop being the defaults.
  const choseLook = Object.keys((settings.global_styles as object) ?? {}).length > 0

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
      id: 'words',
      title: 'Say who you are',
      detail:
        'Replace the starter words on your homepage. In the editor, click any piece of text to change it.',
      href: '/edit/home',
      cta: 'Edit the site',
      done: wroteIntro && wroteTagline,
    },
    {
      id: 'look',
      title: 'Choose your look',
      detail: 'Typeface, colours and spacing, applied everywhere at once.',
      href: '/admin/design',
      cta: 'Look & style',
      done: choseLook,
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
