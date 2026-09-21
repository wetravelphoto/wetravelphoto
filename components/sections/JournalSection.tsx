import Link from 'next/link'
import { photoUrl } from '@/lib/images'
import { srcSetFromPath, SIZES_ATTR } from '@/lib/srcset'
import { styleVars } from '@/lib/type-styles'
import { num, str, type SectionSettings } from '@/lib/sections/registry'
import { editable, typeGroup } from '@/lib/sections/editable'
import type { SectionContext } from '@/lib/sections/context'

export default function JournalSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
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
