import { photoUrl } from '@/lib/images'
import { srcSetFromPath } from '@/lib/srcset'
import { allFonts, sectionVars } from '@/lib/type-styles'
import { list, map, str, type SectionSettings } from '@/lib/sections/registry'
import type { SectionContext } from '@/lib/sections/context'
import HomeHero, { type HeroItem } from '@/components/home/HomeHero'
import { textVarsByField } from '@/lib/sections/text-style'
import { shownBag } from '@/lib/sections/shown'
import TextFonts from '@/components/sections/TextFonts'

type Focal = { x?: number; y?: number; mx?: number; my?: number }

/** The three pieces of copy that belong to the SECTION, not to a story. */
const HERO_TEXT = ['title', 'subtitle', 'cta_label'] as const

/**
 * A FULL-HEIGHT OPENING THAT MOVES
 * ════════════════════════════════
 *
 * Featured stories in turn, each with its own photograph, with the site's own
 * words laid over the lot of them.
 *
 * This was a mode of the standing hero until 2026-09-27. Two thirds of that
 * panel was always irrelevant and nothing said which two thirds, so it is its
 * own block: you pick the opening you want, and everything in its panel
 * applies to it.
 *
 * `source` is a setting rather than another block, because galleries and a
 * carousel of chosen photographs are this same machinery pointed somewhere
 * else — the same sequence, the same overlay, a different list.
 */
export default function SequenceHeroSection({
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
      // A display name and subtitle override the story's own copy in the hero
      // only — the story itself keeps what it was published with.
      title: titles[post.id] || post.title,
      subtitle: subtitles[post.id] || null,
      imageUrl: post.featured_custom_path ? photoUrl(post.featured_custom_path) : null,
      // Without this the hero blocks first paint on a 2400px file.
      imageSrcSet: post.featured_custom_path
        ? srcSetFromPath(photoUrl(post.featured_custom_path))
        : undefined,
      focal: { x: point.x, y: point.y },
      focalMobile: { x: point.mx, y: point.my },
    }
  })

  // Nothing to sequence. Drawing an empty full-height band would push the
  // whole page down for no reason; in the editor it stays so the panel has
  // something to attach to.
  if (items.length === 0 && !ctx.editable) return null

  return (
    <>
      <TextFonts names={allFonts('hero', settings, ctx.styles)} />
      <HomeHero
        items={items}
        titlePosition={str(settings, 'title_position') ?? 'center'}
        storyAlign={(str(settings, 'story_align') ?? 'left') as 'left' | 'center'}
        overlayTitle={str(settings, 'title')}
        overlaySubtitle={str(settings, 'subtitle')}
        ctaLabel={str(settings, 'cta_label')}
        ctaHref={str(settings, 'cta_href')}
        text={textVarsByField(settings, HERO_TEXT)}
        shownOn={shownBag(settings)}
        styleVars={sectionVars('hero', settings, ctx.styles)}
        editable={ctx.editable}
      />
    </>
  )
}

/** True when this would render nothing at all. See PageBody's transparent header. */
export function sequenceHeroIsEmpty(_settings: SectionSettings, ctx: SectionContext): boolean {
  return ctx.posts.length === 0
}
