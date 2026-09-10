import Link from 'next/link'

export default function JournalCard({
  slug,
  title,
  category,
  excerpt,
  imageUrl,
  feature = false,
  showExcerpt = true,
}: {
  slug: string
  title: string
  category: string | null
  excerpt: string | null
  imageUrl: string | null
  feature?: boolean
  showExcerpt?: boolean
}) {
  return (
    <Link href={`/journal/${slug}`} className="journal-card" data-feature={feature}>
      <div className="journal-card-media">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" loading="lazy" />
        )}
      </div>
      {category && <p className="journal-card-cat">{category}</p>}
      <h2 className="journal-card-title">{title}</h2>
      {showExcerpt && excerpt && <p className="journal-card-excerpt">{excerpt}</p>}
    </Link>
  )
}
