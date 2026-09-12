import Link from 'next/link'

export default function JournalCard({
  slug,
  title,
  category,
  excerpt,
  byline,
  dateLabel,
  imageUrl,
  imageSrcSet,
  feature = false,
  showExcerpt = true,
  showByline = false,
  showDate = false,
}: {
  slug: string
  title: string
  category: string | null
  excerpt: string | null
  byline?: string | null
  dateLabel?: string | null
  imageUrl: string | null
  imageSrcSet?: string
  feature?: boolean
  showExcerpt?: boolean
  showByline?: boolean
  showDate?: boolean
}) {
  const meta = [showDate ? dateLabel : null, showByline ? byline : null].filter(Boolean)

  return (
    <Link href={`/journal/${slug}`} className="journal-card" data-feature={feature}>
      {/* The category runs down the right edge, ending level with the photo */}
      <div className="journal-card-media-row">
        <div className="journal-card-media">
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              srcSet={imageSrcSet}
              sizes="(max-width: 620px) 100vw, (max-width: 1000px) 50vw, 33vw"
              alt=""
              loading="lazy"
            />
          )}
        </div>

        {category && <span className="journal-card-cat">{category}</span>}
      </div>

      <h2 className="journal-card-title">{title}</h2>

      {meta.length > 0 && <p className="journal-card-meta">{meta.join(' · ')}</p>}

      {showExcerpt && excerpt && <p className="journal-card-excerpt">{excerpt}</p>}
    </Link>
  )
}
