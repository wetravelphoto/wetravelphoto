import { photoUrl } from '@/lib/images'
import { srcSetFromPath, SIZES_ATTR } from '@/lib/srcset'
import { allFonts, sectionVars } from '@/lib/type-styles'
import { str, type SectionSettings } from '@/lib/sections/registry'
import { live, styledText, typeRoot } from '@/lib/sections/editable'
import TextFonts from '@/components/sections/TextFonts'
import type { SectionContext } from '@/lib/sections/context'

export default function IntroSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  const heading = str(settings, 'heading')
  const kicker = str(settings, 'kicker')
  const image = str(settings, 'image_path')
  const paragraphs = (str(settings, 'body') ?? '').split('\n\n').filter(Boolean)

  if (!heading && paragraphs.length === 0 && !image && !ctx.editable) return null

  return (
    <section className="home-section" style={sectionVars('intro', settings, ctx.styles)} {...typeRoot(ctx)}>
      <TextFonts names={allFonts('intro', settings, ctx.styles)} />
      <div className="home-inner intro-grid" data-side={settings.image_side} {...live(ctx, ['image_side'])}>
        {image && (
          <div className="intro-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl(image)}
              srcSet={srcSetFromPath(photoUrl(image))}
              sizes={SIZES_ATTR.halfWidth}
              alt=""
              loading="lazy"
              decoding="async"
            />
          </div>
        )}

        <div>
          {(kicker || ctx.editable) && (
            <p className="intro-kicker" {...styledText(ctx, settings, 'kicker')}>
              {kicker}
            </p>
          )}
          {(heading || ctx.editable) && (
            <h2 className="intro-heading" {...styledText(ctx, settings, 'heading')}>
              {heading}
            </h2>
          )}
          <div className="intro-body" {...styledText(ctx, settings, 'body')}>
            {paragraphs.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
