import Link from 'next/link'
import { photoUrl } from '@/lib/images'
import { srcSetFromPath, SIZES_ATTR } from '@/lib/srcset'
import { styleVars } from '@/lib/type-styles'
import { num, str, type SectionSettings } from '@/lib/sections/registry'
import { editable, live, typeGroup } from '@/lib/sections/editable'
import type { SectionContext } from '@/lib/sections/context'
import { formatTripDate } from '@/lib/dates'
import JournalCard from '@/components/blog/JournalCard'
import '@/app/journal/journal.css'
import '@/app/journal/journal-cards.css'

export default function JournalSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  if (str(settings, 'layout') === 'grid') return <JournalGrid settings={settings} ctx={ctx} />

  const posts = ctx.posts.slice(0, num(settings, 'count', 3))
  if (posts.length === 0) return null

  const cta = str(settings, 'cta_label')

  return (
    <section className="home-section" style={styleVars(ctx.styles, 'journal')} {...typeGroup(ctx, 'journal')}>
      <div className="home-inner">
        <div className="journal-section-head">
          <h2 className="section-title" {...editable(ctx, 'heading')}>
            {str(settings, 'heading') || 'From the journal'}
          </h2>
        </div>

        <div className="journal-trio">
          {posts.map((post) => (
            <Link key={post.id} href={`/journal/${post.slug}`} className="trio-card">
              <div className="trio-media">
                <div className="trio-image">
                  {post.featured_custom_path && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photoUrl(post.featured_custom_path)}
                      srcSet={srcSetFromPath(photoUrl(post.featured_custom_path))}
                      sizes={SIZES_ATTR.grid}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </div>
                {post.category && <span className="trio-label">{post.category}</span>}
              </div>

              <h3 className="trio-title">{post.title}</h3>
              {post.excerpt && <p className="trio-excerpt">{post.excerpt}</p>}
            </Link>
          ))}
        </div>

        {cta && (
          <div className="section-cta">
            <Link href="/journal">{cta}</Link>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * The Journal page: every published story, the newest drawn large. This is
 * the markup app/journal/page.tsx used to draw by hand. Like the galleries
 * grid it takes no section typography — its type lives in journal-cards.css,
 * with the one title-size control it always had.
 */
function JournalGrid({ settings, ctx }: { settings: SectionSettings; ctx: SectionContext }) {
  const eyebrow = str(settings, 'eyebrow')
  const scale = num(settings, 'title_scale', 1)
  const cover = (path: string | null) => (path ? photoUrl(path) : null)

  return (
    <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 5rem' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {(eyebrow || ctx.editable) && (
          <p className="eyebrow" style={{ margin: '0 0 0.75rem' }} {...editable(ctx, 'eyebrow')}>
            {eyebrow}
          </p>
        )}
        <h1
          className="display"
          style={{ fontSize: 'clamp(2rem, 5vw, 3.1rem)', margin: '0 0 3rem', lineHeight: 1 }}
          {...editable(ctx, 'heading')}
        >
          {str(settings, 'heading') || 'Journal'}
        </h1>

        {ctx.posts.length > 0 ? (
          <div
            className="journal-grid"
            // The title size is written as the custom property the cards read,
            // on the element the editor can repaint while the slider moves.
            style={{ ['--journal-title-scale' as string]: String(scale) } as React.CSSProperties}
            {...live(ctx, ['title_scale'])}
          >
            {ctx.posts.map((post, i) => (
              <JournalCard
                key={post.id}
                slug={post.slug}
                title={post.title}
                category={post.category}
                excerpt={post.excerpt}
                byline={post.byline}
                dateLabel={post.published_at ? formatTripDate(post.published_at, 'full') : null}
                imageUrl={cover(post.featured_custom_path)}
                imageSrcSet={srcSetFromPath(cover(post.featured_custom_path))}
                feature={i === 0}
                showExcerpt={settings.show_excerpt !== false}
                showByline={settings.show_byline === true}
                showDate={settings.show_date === true}
              />
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--ink-mute)' }}>No published entries yet.</p>
        )}
      </div>
    </div>
  )
}
