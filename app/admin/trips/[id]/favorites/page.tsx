import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { requireEditor } from '@/lib/auth'
import { imageSrc } from '@/lib/images'

export default async function AlbumFavoritesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data: album } = await supabase
    .from('albums')
    .select('title')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .single()

  const { data: favorites } = await supabase
    .from('favorites')
    .select('photo_id, client_id, clients(name, email), photos(storage_path, caption)')
    .eq('album_id', id)

  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

  const byClient = new Map<
    string,
    { name: string; email: string; photos: { path: string; caption: string | null }[] }
  >()

  favorites?.forEach((fav) => {
    const client = fav.clients as unknown as { name: string; email: string } | null
    const photo = fav.photos as unknown as { storage_path: string; caption: string | null } | null
    if (!client || !photo || !fav.client_id) return

    if (!byClient.has(fav.client_id)) {
      byClient.set(fav.client_id, { name: client.name, email: client.email, photos: [] })
    }
    byClient.get(fav.client_id)!.photos.push({ path: photo.storage_path, caption: photo.caption })
  })

  return (
    <div style={{ maxWidth: 760 }}>
      <p className="admin-crumb">
        <Link href="/admin">Albums</Link> / <Link href={`/admin/trips/${id}`}>{album?.title}</Link> / Favorites
      </p>
      <h1 className="admin-h1" style={{ marginBottom: '1.5rem' }}>
        Client favorites
      </h1>

      {byClient.size === 0 && (
        <div className="admin-empty">
          No favorites yet. When a client stars photos in their private gallery, they appear here.
        </div>
      )}

      {Array.from(byClient.entries()).map(([clientId, data]) => (
        <div key={clientId} className="admin-panel" style={{ marginBottom: '1rem' }}>
          <h2 className="admin-h2" style={{ marginBottom: '0.35rem' }}>
            {data.name}
          </h2>
          <p className="admin-meta" style={{ margin: '0 0 0.85rem' }}>
            {data.email} · {data.photos.length} favorite{data.photos.length === 1 ? '' : 's'}
          </p>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {data.photos.map((photo, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={imageSrc(publicUrl, photo.path ?? '')}
                alt={photo.caption ?? ''}
                title={photo.caption ?? ''}
                style={{ width: 84, height: 84, objectFit: 'cover', display: 'block' }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
