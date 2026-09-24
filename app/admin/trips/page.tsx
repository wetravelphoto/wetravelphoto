import { createClient } from '@/lib/supabase/server'
import { attachCovers, photoCounts } from '@/lib/album-covers'
import GalleryGrid from '@/components/admin/GalleryGrid'
import Link from 'next/link'
import { requireEditor } from '@/lib/auth'
import SampleNotice from '@/components/admin/SampleNotice'
import { SAMPLE_ALBUM_SLUG } from '@/lib/samples'

export const dynamic = 'force-dynamic'

type SortKey = 'manual' | 'newest' | 'oldest' | 'title' | 'photos'

export default async function GalleriesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const { sort } = await searchParams
  const sortKey = (sort ?? 'manual') as SortKey

  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  // Covers and counts come from bounded queries. Embedding every photo row of
  // every gallery here is what made this page fail with "bad gateway".
  const { data: albumData, error } = await supabase
    .from('albums')
    .select('*')
    .eq('tenant_id', tenantId)
    // display_order is the gallery's position. albums.sort_order is text and
    // means the photo sort mode inside the album — don't order by it here.
    .order('display_order', { ascending: true })

  const base = (albumData ?? []) as {
    id: string
    cover_photo_id: string | null
    cover_custom_path: string | null
    [key: string]: unknown
  }[]

  const [albums, counts] = await Promise.all([
    attachCovers(base),
    photoCounts(base.map((a) => a.id)),
  ])

  const rows = albums.map((album) => ({
    id: album.id as string,
    title: album.title as string,
    slug: (album.slug as string) ?? null,
    privacy: (album.privacy_type as string) ?? 'public',
    photoCount: counts.get(album.id) ?? 0,
    coverUrl: album.coverUrl,
    createdAt: album.created_at as string,
    updatedAt: (album.updated_at as string) ?? (album.created_at as string),
    sortOrder: (album.display_order as number) ?? 0,
  }))

  const sorted = [...rows].sort((a, b) => {
    if (sortKey === 'oldest') return a.createdAt.localeCompare(b.createdAt)
    if (sortKey === 'newest') return b.createdAt.localeCompare(a.createdAt)
    if (sortKey === 'title') return a.title.localeCompare(b.title)
    if (sortKey === 'photos') return b.photoCount - a.photoCount
    return a.sortOrder - b.sortOrder
  })

  const hasSamples = base.some((a) => a.slug === SAMPLE_ALBUM_SLUG)


  const totalPhotos = rows.reduce((sum, r) => sum + r.photoCount, 0)
  const publicCount = rows.filter((r) => r.privacy === 'public').length

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'manual', label: 'Custom order' },
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

      {(hasSamples || rows.length === 0) && <SampleNotice present={hasSamples} />}

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
        <GalleryGrid rows={sorted} manualOrder={sortKey === 'manual'} />
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
