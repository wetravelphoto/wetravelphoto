import type { InstagramPost } from '@/lib/instagram'

/**
 * Nine recent posts across a 5×3 grid. The first and sixth span 2×2, giving
 * a large tile at the top-left and another at the bottom-right, with the
 * seven singles filling every remaining cell.
 */
export default function InstagramFeed({
  posts,
  heading,
  handle,
  editable = false,
}: {
  posts: InstagramPost[]
  heading: string | null
  handle: string | null
  /** True only in the editor's preview. The handle comes from Settings, so it
   *  is not tagged — only the heading belongs to this section. */
  editable?: boolean
}) {
  if (posts.length === 0) return null

  const profileUrl = handle ? `https://instagram.com/${handle.replace('@', '')}` : null
  const shown = posts.slice(0, 9)

  // These two positions produce the diagonal pair once all nine are present
  const featureIndexes = shown.length === 9 ? [0, 5] : []

  return (
    <section className="ig-section">
      <div className="ig-head">
        <h2 className="ig-heading" {...(editable ? { 'data-field': 'heading' } : {})}>
          {heading || 'Instagram'}
        </h2>
        {profileUrl && (
          <a href={profileUrl} target="_blank" rel="noopener" className="ig-handle">
            @{handle?.replace('@', '')}
          </a>
        )}
      </div>

      <div className="ig-grid">
        {shown.map((post, i) => (
          <a
            key={post.id}
            href={post.permalink}
            target="_blank"
            rel="noopener"
            className="ig-item"
            data-feature={featureIndexes.includes(i)}
            aria-label={post.caption ? post.caption.slice(0, 80) : 'View on Instagram'}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* Instagram serves one size only, so there's no srcset to offer.
                The square ratio at least reserves the space so the page below
                doesn't jump as tiles arrive. */}
            <img
              src={post.media_url}
              alt={post.caption?.slice(0, 120) ?? ''}
              width={1080}
              height={1080}
              loading="lazy"
              decoding="async"
            />
            {post.media_type === 'VIDEO' && <span className="ig-badge">Video</span>}
          </a>
        ))}
      </div>
    </section>
  )
}
