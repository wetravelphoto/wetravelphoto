import { photoUrl } from '@/lib/images'
import { srcSetFromPath } from '@/lib/srcset'
import { styleVars } from '@/lib/type-styles'
import { bool, list, map, str, type SectionSettings } from '@/lib/sections/registry'
import type { SectionContext } from '@/lib/sections/context'
import HomeHero, { type HeroItem } from '@/components/home/HomeHero'
import FixedHero from '@/components/home/FixedHero'
import BirdBadge from '@/components/BirdBadge'

type Focal = { x?: number; y?: number; mx?: number; my?: number }

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
  const vars = styleVars(ctx.styles, 'hero')

  // Fall back to the standing image whenever there are no stories to show
  const fixed = settings.mode === 'fixed' || items.length === 0

  return (
    <>
      {fixed ? (
        <FixedHero
          imageUrl={str(settings, 'image_path') ? photoUrl(settings.image_path as string) : null}
          title={str(settings, 'title')}
          subtitle={str(settings, 'subtitle')}
          ctaLabel={str(settings, 'cta_label')}
          ctaHref={str(settings, 'cta_href')}
          focal={{ x: focal.x ?? 0.5, y: focal.y ?? 0.5 }}
          focalMobile={{ x: focal.mx ?? 0.5, y: focal.my ?? 0.5 }}
          showMark={bool(settings, 'show_mark')}
          markPosition={position}
          logoUrl={ctx.settings.logo_header_path ? photoUrl(ctx.settings.logo_header_path) : null}
          siteTitle={ctx.settings.site_title}
          styleVars={vars}
          editable={ctx.editable}
        />
      ) : (
        <HomeHero
          items={items}
          titlePosition={position}
          showMark={bool(settings, 'show_mark')}
          storyAlign={(str(settings, 'story_align') ?? 'left') as 'left' | 'center'}
          overlayTitle={str(settings, 'title')}
          overlaySubtitle={str(settings, 'subtitle')}
          ctaLabel={str(settings, 'cta_label')}
          ctaHref={str(settings, 'cta_href')}
          styleVars={vars}
        />
      )}

      {/* The brand mark lives in the light band directly under the hero, so it
          travels with it rather than floating between whatever two sections
          happen to be first. */}
      <BirdBadge />
    </>
  )
}

/** True when the hero would render nothing at all. */
export function heroIsEmpty(settings: SectionSettings, ctx: SectionContext): boolean {
  if (settings.mode === 'fixed') return !str(settings, 'image_path')
  return ctx.posts.length === 0 && !str(settings, 'image_path')
}
