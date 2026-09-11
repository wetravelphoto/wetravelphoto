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
}: {
  posts: InstagramPost[]
  heading: string | null
  handle: string | null
}) {
  if (posts.length === 0) return null

  const profileUrl = handle ? `https://instagram.com/${handle.replace('@', '')}` : null
  const shown = posts.slice(0, 9)

  // These two positions produce the diagonal pair once all nine are present
  const featureIndexes = shown.length === 9 ? [0, 5] : []

  return (
    <section className="ig-section">
      <div className="ig-head">
        <h2 className="ig-heading">{heading || 'Instagram'}</h2>
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
            <img src={post.media_url} alt={post.caption?.slice(0, 120) ?? ''} loading="lazy" />
            {post.media_type === 'VIDEO' && <span className="ig-badge">Video</span>}
          </a>
        ))}
      </div>
    </section>
  )
}
