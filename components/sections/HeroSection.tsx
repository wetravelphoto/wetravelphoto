import { photoUrl } from '@/lib/images'
import { allFonts, sectionVars } from '@/lib/type-styles'
import { str, type SectionSettings } from '@/lib/sections/registry'
import type { SectionContext } from '@/lib/sections/context'
import { spotPair } from '@/lib/sections/spots'
import { backdropFor, hasOwnBackdrop, type BackdropValues } from '@/lib/sections/backdrop'
import { BASE_DEVICE } from '@/lib/sections/devices'
import { textVarsByField } from '@/lib/sections/text-style'
import { shownBag } from '@/lib/sections/shown'
import TextFonts from '@/components/sections/TextFonts'
import FixedHero, { type Backdrop } from '@/components/home/FixedHero'

type Focal = { x?: number; y?: number; mx?: number; my?: number }

/** The three pieces of copy this block owns. */
const HERO_TEXT = ['title', 'subtitle', 'cta_label'] as const

/**
 * THE STANDING OPENING
 * ════════════════════
 *
 * One backdrop — a photograph, a video or a color — with the site's words
 * over it.
 *
 * ── Why three backdrops and not three blocks ────────────────────────────────
 *
 * The sequence hero is a separate block because it is a different thing: it
 * has stories, they take turns, and two thirds of its settings mean nothing
 * here. These three are the same thing with a different source. The words,
 * their fifteen places, their typography and where they appear all mean
 * exactly what they meant before, so swapping a photograph for a color is a
 * change of backdrop rather than a rebuild.
 *
 * That is the line: a block is a thing you are making, a setting is a choice
 * within it. "Photograph or video" is a choice; "one picture or a rotation of
 * stories" was never one, which is why it read as a pile of options.
 */
export default function HeroSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  const focal = (settings.focal ?? {}) as Focal

  const url = (path: string | null) => (path ? photoUrl(path) : null)
  /*
   * Everything about the backdrop is resolved and sanitised in one place
   * (lib/sections/backdrop.ts) and turned into URLs here. Which size sees
   * which is the module's question, not this component's.
   */
  const drawn = (b: BackdropValues): Backdrop => ({
    kind: b.kind,
    imageUrl: url(b.imagePath),
    videoUrl: url(b.videoPath),
    posterUrl: url(b.posterPath),
    color: b.color,
    dim: b.dim,
  })

  /*
   * NULL UNLESS THE PHONE HAS BEEN GIVEN A BACKDROP OF ITS OWN.
   *
   * Not "unless the two happen to differ": a phone that has been set to the
   * same photograph deliberately still gets its own resolved values, because
   * `dim` and the color can differ without any of the media doing so. Null is
   * the common case and the one that draws exactly what it always drew.
   */
  const mobile = hasOwnBackdrop(settings, 'mobile')
    ? drawn(backdropFor(settings, 'mobile'))
    : null

  return (
    <>
      <TextFonts names={allFonts('hero', settings, ctx.styles)} />
      <FixedHero
        backdrop={drawn(backdropFor(settings, BASE_DEVICE))}
        backdropMobile={mobile}
        title={str(settings, 'title')}
        subtitle={str(settings, 'subtitle')}
        ctaLabel={str(settings, 'cta_label')}
        ctaHref={str(settings, 'cta_href')}
        focal={{ x: focal.x ?? 0.5, y: focal.y ?? 0.5 }}
        focalMobile={{ x: focal.mx ?? 0.5, y: focal.my ?? 0.5 }}
        titleSpot={spotPair(settings, 'title_spot')}
        subtitleSpot={spotPair(settings, 'subtitle_spot')}
        ctaSpot={spotPair(settings, 'cta_spot')}
        shown={shownBag(settings)}
        text={textVarsByField(settings, HERO_TEXT)}
        styleVars={sectionVars('hero', settings, ctx.styles)}
        editable={ctx.editable}
      />
    </>
  )
}

/**
 * True when this would render nothing worth putting a transparent header over.
 *
 * A color counts: it is a deliberate full-height band, and the header should
 * sit on it the way it sits on a photograph. An empty photograph backdrop does
 * not.
 */
export function heroIsEmpty(settings: SectionSettings): boolean {
  // Per size, and empty only if BOTH are: a hero with a photograph on a wide
  // screen and nothing set for the phone is not an empty hero, and a header
  // that decided otherwise would go opaque on one width and transparent on
  // the other.
  const bare = (b: BackdropValues) => {
    if (b.kind === 'color') return false
    if (b.kind === 'video') return !b.videoPath && !b.posterPath
    return !b.imagePath
  }
  return bare(backdropFor(settings, 'desktop')) && bare(backdropFor(settings, 'mobile'))
}
