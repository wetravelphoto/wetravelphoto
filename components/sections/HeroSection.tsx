import { photoUrl } from '@/lib/images'
import { srcSetFromPath } from '@/lib/srcset'
import { sectionVars } from '@/lib/type-styles'
import { list, map, str, type SectionSettings } from '@/lib/sections/registry'
import type { SectionContext } from '@/lib/sections/context'
import HomeHero, { type HeroItem } from '@/components/home/HomeHero'
import { spotPair } from '@/lib/sections/spots'
import { textVarsByField } from '@/lib/sections/text-style'
import { shownBag } from '@/lib/sections/shown'
import { allFonts } from '@/lib/type-styles'
import TextFonts from '@/components/sections/TextFonts'
import FixedHero from '@/components/home/FixedHero'

type Focal = { x?: number; y?: number; mx?: number; my?: number }

/** The three pieces of copy the hero owns, in both of its modes. */
const HERO_TEXT = ['title', 'subtitle', 'cta_label'] as const

export default function HeroSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  const featuredIds = list(settings, 'featured_post_ids')

  const featured = featuredIds.length
    ? (featuredIds.map((id) => ctx.posts.find((p) => p.id === id)).filter(Boolean) as typeof ctx.posts)
    : ctx.posts.slice(0, 3)

  const titles = map<string>(settings, 'titles')
  const subtitles = map<string>(settings, 'subtitles')
  const storyFocal = map<Required<Focal>>(settings, 'story_focal')

  const items: HeroItem[] = featured.slice(0, 3).map((post) => {
    const point = storyFocal[post.id] ?? { x: 0.5, y: 0.5, mx: 0.5, my: 0.5 }

    return {
      slug: post.slug,
      // Display name and subtitle override the story's own copy in the hero only
      title: titles[post.id] || post.title,
      subtitle: subtitles[post.id] || null,
      imageUrl: post.featured_custom_path ? photoUrl(post.featured_custom_path) : null,
      // Without this the hero blocks first paint on a 2400px file
      imageSrcSet: post.featured_custom_path
        ? srcSetFromPath(photoUrl(post.featured_custom_path))
        : undefined,
      focal: { x: point.x, y: point.y },
      focalMobile: { x: point.mx, y: point.my },
    }
  })

  const focal = (settings.focal ?? {}) as Focal
  const position = str(settings, 'title_position') ?? 'center'
  const vars = sectionVars('hero', settings, ctx.styles)

  // Fall back to the standing image whenever there are no stories to show
  const fixed = settings.mode === 'fixed' || items.length === 0

  // Both the section's own typefaces and any a single piece of text asked
  // for. Neither was being loaded before.
  const needed = allFonts('hero', settings, ctx.styles)

  return (
    <>
      <TextFonts names={needed} />
      {fixed ? (
        <FixedHero
          imageUrl={str(settings, 'image_path') ? photoUrl(settings.image_path as string) : null}
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
          styleVars={vars}
          editable={ctx.editable}
        />
      ) : (
        <HomeHero
          items={items}
          titlePosition={position}
          storyAlign={(str(settings, 'story_align') ?? 'left') as 'left' | 'center'}
          overlayTitle={str(settings, 'title')}
          overlaySubtitle={str(settings, 'subtitle')}
          ctaLabel={str(settings, 'cta_label')}
          ctaHref={str(settings, 'cta_href')}
          text={textVarsByField(settings, HERO_TEXT)}
          shownOn={shownBag(settings)}
          styleVars={vars}
          editable={ctx.editable}
        />
      )}

    </>
  )
}

/** True when the hero would render nothing at all. */
export function heroIsEmpty(settings: SectionSettings, ctx: SectionContext): boolean {
  if (settings.mode === 'fixed') return !str(settings, 'image_path')
  return ctx.posts.length === 0 && !str(settings, 'image_path')
}
