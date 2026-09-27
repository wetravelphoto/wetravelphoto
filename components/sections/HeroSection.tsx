import { photoUrl } from '@/lib/images'
import { allFonts, sectionVars } from '@/lib/type-styles'
import { num, str, type SectionSettings } from '@/lib/sections/registry'
import type { SectionContext } from '@/lib/sections/context'
import { spotPair } from '@/lib/sections/spots'
import { textVarsByField } from '@/lib/sections/text-style'
import { shownBag } from '@/lib/sections/shown'
import TextFonts from '@/components/sections/TextFonts'
import FixedHero, { type Backdrop } from '@/components/home/FixedHero'

type Focal = { x?: number; y?: number; mx?: number; my?: number }

/** The three pieces of copy this block owns. */
const HERO_TEXT = ['title', 'subtitle', 'cta_label'] as const

const KINDS = ['image', 'video', 'color'] as const

/**
 * THE STANDING OPENING
 * ════════════════════
 *
 * One backdrop — a photograph, a video or a colour — with the site's words
 * over it.
 *
 * ── Why three backdrops and not three blocks ────────────────────────────────
 *
 * The sequence hero is a separate block because it is a different thing: it
 * has stories, they take turns, and two thirds of its settings mean nothing
 * here. These three are the same thing with a different source. The words,
 * their fifteen places, their typography and where they appear all mean
 * exactly what they meant before, so swapping a photograph for a colour is a
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
  const kind = (KINDS as readonly string[]).includes(str(settings, 'backdrop') ?? '')
    ? (str(settings, 'backdrop') as Backdrop['kind'])
    : 'image'

  const path = (key: string) => {
    const value = str(settings, key)
    return value ? photoUrl(value) : null
  }

  return (
    <>
      <TextFonts names={allFonts('hero', settings, ctx.styles)} />
      <FixedHero
        backdrop={{
          kind,
          imageUrl: path('image_path'),
          videoUrl: path('video_path'),
          posterUrl: path('video_poster'),
          // Sanitised where it is stored, and again on the way out: this ends
          // up in an inline custom property.
          color: /^#[0-9a-f]{3,8}$/i.test(str(settings, 'backdrop_color') ?? '')
            ? (str(settings, 'backdrop_color') as string)
            : '#14100e',
          dim: Math.min(80, Math.max(0, num(settings, 'dim', 0))),
        }}
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
 * A colour counts: it is a deliberate full-height band, and the header should
 * sit on it the way it sits on a photograph. An empty photograph backdrop does
 * not.
 */
export function heroIsEmpty(settings: SectionSettings): boolean {
  const kind = str(settings, 'backdrop') ?? 'image'
  if (kind === 'color') return false
  if (kind === 'video') return !str(settings, 'video_path') && !str(settings, 'video_poster')
  return !str(settings, 'image_path')
}
