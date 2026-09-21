import Link from 'next/link'
import { photoUrl } from '@/lib/images'
import { sectionVars } from '@/lib/type-styles'
import { str, type SectionSettings } from '@/lib/sections/registry'
import { editable, live, typeRoot } from '@/lib/sections/editable'
import type { SectionContext } from '@/lib/sections/context'
import '@/app/about/about.css'

/* eslint-disable @next/next/no-img-element */

/**
 * The About page's split: a full-height photograph beside the story.
 *
 * This is the markup app/about/page.tsx used to draw by hand from the about_*
 * columns, moved into a section so the page can be edited in the canvas — and
 * so the same block can sit on any other page. The stylesheet is imported here
 * rather than by the route, so it arrives wherever the section is used.
 *
 * The heading is an <h1> because on the About page it is the page's title.
 */
export default function AboutSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  const eyebrow = str(settings, 'eyebrow')
  const heading = str(settings, 'heading')
  const image = str(settings, 'image_path')
  const ctaLabel = str(settings, 'cta_label')
  const ctaHref = str(settings, 'cta_href')
  const paragraphs = (str(settings, 'body') ?? '').split('\n\n').filter(Boolean)

  return (
    <article
      className="about"
      data-side={settings.image_side}
      style={sectionVars('about', settings, ctx.styles)}
      {...live(ctx, ['image_side'])}
      {...typeRoot(ctx)}
    >
      {image && (
        <div className="about-media">
          <img src={photoUrl(image)} alt="" />
        </div>
      )}

      <div className="about-panel">
        <div className="about-inner">
          {(eyebrow || ctx.editable) && (
            <p className="about-eyebrow" {...editable(ctx, 'eyebrow')}>
              {eyebrow}
            </p>
          )}

          {(heading || ctx.editable) && (
            <h1 className="about-heading" {...editable(ctx, 'heading')}>
              {heading}
            </h1>
          )}

          {paragraphs.length > 0 || ctx.editable ? (
            <div className="about-body" {...editable(ctx, 'body')}>
              {paragraphs.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          ) : (
            <p className="about-body" style={{ color: 'var(--ink-mute)' }}>
              Nothing here yet.
            </p>
          )}

          {/* In the editor the button shows once it has a label, so there is
              something to click; in public it also needs somewhere to go. */}
          {ctaLabel && (ctaHref || ctx.editable) && (
            <Link href={ctaHref ?? '#'} className="about-cta" {...editable(ctx, 'cta_label')}>
              {ctaLabel}
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}
