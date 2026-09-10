import { createClient } from '@/lib/supabase/server'
import GalleryCard from '@/components/admin/GalleryCard'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

type SortKey = 'newest' | 'oldest' | 'title' | 'photos'

export default async function GalleriesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const { sort } = await searchParams
  const sortKey = (sort ?? 'newest') as SortKey

  const supabase = await createClient()

  // Disambiguated join — albums link to photos twice (album_id and cover_photo_id)
  const { data: albums, error } = await supabase
    .from('albums')
    .select('*, photos!photos_album_id_fkey(id, storage_path)')
    .order('created_at', { ascending: false })

  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL

  const rows = (albums ?? []).map((album) => {
    const photos = (album.photos ?? []) as { id: string; storage_path: string }[]
    const coverPath = album.cover_custom_path
      ? album.cover_custom_path
      : (photos.find((p) => p.id === album.cover_photo_id) ?? photos[0])?.storage_path

    return {
      id: album.id as string,
      title: album.title as string,
      slug: (album.slug as string) ?? null,
      privacy: (album.privacy_type as string) ?? 'public',
      photoCount: photos.length,
      coverUrl: coverPath ? `${publicUrl}/${coverPath}` : null,
      createdAt: album.created_at as string,
      updatedAt: (album.updated_at as string) ?? (album.created_at as string),
    }
  })

  const sorted = [...rows].sort((a, b) => {
    if (sortKey === 'oldest') return a.createdAt.localeCompare(b.createdAt)
    if (sortKey === 'title') return a.title.localeCompare(b.title)
    if (sortKey === 'photos') return b.photoCount - a.photoCount
    return b.createdAt.localeCompare(a.createdAt)
  })

  const totalPhotos = rows.reduce((sum, r) => sum + r.photoCount, 0)
  const publicCount = rows.filter((r) => r.privacy === 'public').length

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'newest', label: 'Newest' },
    { key: 'oldest', label: 'Oldest' },
    { key: 'title', label: 'A–Z' },
    { key: 'photos', label: 'Most photos' },
  ]

  return (
    <div>
      <div className="gallery-head">
        <div>
          <h1 className="admin-h1">Galleries</h1>
          <p className="admin-meta" style={{ margin: '0.35rem 0 0' }}>
            {rows.length} galler{rows.length === 1 ? 'y' : 'ies'} · {totalPhotos} photograph
            {totalPhotos === 1 ? '' : 's'} · {publicCount} public
          </p>
        </div>
        <Link href="/admin/trips/new" className="admin-btn">
          New gallery
        </Link>
      </div>

      {error && (
        <div className="admin-panel" style={{ borderColor: 'rgba(163,50,36,0.4)', marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--admin-danger)' }}>
            Couldn&apos;t load galleries: {error.message}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="gallery-sort">
          <span className="admin-meta">Sort</span>
          {sortOptions.map((option) => (
            <Link
              key={option.key}
              href={`/admin/trips?sort=${option.key}`}
              className="admin-btn admin-btn-sm admin-btn-ghost"
              data-active={sortKey === option.key}
            >
              {option.label}
            </Link>
          ))}
        </div>
      )}

      {sorted.length > 0 ? (
        <div className="gallery-grid">
          {sorted.map((row) => (
            <GalleryCard
              key={row.id}
              id={row.id}
              title={row.title}
              slug={row.slug}
              privacy={row.privacy}
              photoCount={row.photoCount}
              coverUrl={row.coverUrl}
              updatedAt={row.updatedAt}
            />
          ))}
        </div>
      ) : (
        !error && (
          <div className="admin-empty">
            <p style={{ margin: '0 0 1rem' }}>No galleries yet.</p>
            <Link href="/admin/trips/new" className="admin-btn">
              Create your first gallery
            </Link>
          </div>
        )
      )}
    </div>
  )
}
