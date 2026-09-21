import Link from 'next/link'
import { photoUrl } from '@/lib/images'
import { srcSetFromPath, SIZES_ATTR } from '@/lib/srcset'
import { sectionVars } from '@/lib/type-styles'
import { num, str, type SectionSettings } from '@/lib/sections/registry'
import { editable, live, typeRoot } from '@/lib/sections/editable'
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
    <section className="home-section" style={sectionVars('journal', settings, ctx.styles)} {...typeRoot(ctx)}>
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
 * The Journal page: every published story. This is the markup
 * app/journal/page.tsx used to draw by hand, with three arrangements:
 *
 *   · feature — the newest drawn large, the rest flowing after (the original)
 *   · single  — one wide column, every story large, like a magazine's contents
 *   · columns — even columns of two or three, every story the same size
 *
 * The heading, over-line and excerpts read the section's own typography and
 * fall back to exactly the type they always had.
 */
const GRID_STYLES = ['feature', 'single', 'columns'] as const

function JournalGrid({ settings, ctx }: { settings: SectionSettings; ctx: SectionContext }) {
  const eyebrow = str(settings, 'eyebrow')
  const scale = num(settings, 'title_scale', 1)
  const cover = (path: string | null) => (path ? photoUrl(path) : null)
  const arrangement = GRID_STYLES.includes(settings.grid_style as (typeof GRID_STYLES)[number])
    ? (settings.grid_style as (typeof GRID_STYLES)[number])
    : 'feature'
  const columns = Math.min(3, Math.max(2, Math.round(num(settings, 'grid_columns', 3))))

  return (
    <div
      style={{
        flex: 1,
        padding: '7rem clamp(1.25rem, 4vw, 3rem) 5rem',
        ...sectionVars('journal', settings, ctx.styles),
      }}
      {...typeRoot(ctx)}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {(eyebrow || ctx.editable) && (
          <p className="eyebrow" style={{ margin: '0 0 0.75rem' }} {...editable(ctx, 'eyebrow')}>
            {eyebrow}
          </p>
        )}
        <h1 className="display journal-page-title" {...editable(ctx, 'heading')}>
          {str(settings, 'heading') || 'Journal'}
        </h1>

        {ctx.posts.length > 0 ? (
          <div
            className="journal-grid"
            data-arrangement={arrangement}
            data-cols={columns}
            // The title size is written as the custom property the cards read,
            // on the element the editor can repaint while the slider moves.
            style={{ ['--journal-title-scale' as string]: String(scale) } as React.CSSProperties}
            {...live(ctx, ['title_scale', 'grid_columns'])}
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
                feature={arrangement === 'feature' ? i === 0 : arrangement === 'single'}
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
