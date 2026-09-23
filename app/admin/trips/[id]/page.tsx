import { createClient } from '@/lib/supabase/server'
import PhotoUploader from '@/components/admin/PhotoUploader'
import PhotoGrid from '@/components/admin/PhotoGrid'
import Link from 'next/link'
import { requireEditor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data: album } = await supabase
    .from('albums')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .single()
  const { data: photos } = await supabase
    .from('photos')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('album_id', id)
    .order('sort_order', { ascending: true })

  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''
  const isPublic = album?.privacy_type === 'public'
  const forSaleCount = photos?.filter((p) => p.is_for_sale).length ?? 0

  return (
    <div>
      <p className="admin-crumb">
        <Link href="/admin">&larr; Albums</Link>
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '0.75rem',
        }}
      >
        <div>
          <h1 className="admin-h1">{album?.title}</h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <span className="admin-tag" data-tone={isPublic ? 'live' : 'private'}>
              {album?.privacy_type?.replace('_', ' ')}
            </span>
            <span className="admin-meta">{photos?.length ?? 0} photos</span>
            {forSaleCount > 0 && <span className="admin-meta">&middot; {forSaleCount} for sale</span>}
            {album?.slug && <span className="admin-meta">&middot; /trips/{album.slug}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link href={`/admin/trips/${id}/settings`} className="admin-btn admin-btn-ghost">
            Settings
          </Link>
          <Link href={`/admin/trips/${id}/stats`} className="admin-btn admin-btn-ghost">
            Stats
          </Link>
          <Link href={`/admin/trips/${id}/favorites`} className="admin-btn admin-btn-ghost">
            Favorites
          </Link>
          {isPublic && album?.slug && (
            <Link href={`/trips/${album.slug}`} target="_blank" className="admin-btn admin-btn-ghost">
              View &#8599;
            </Link>
          )}
        </div>
      </div>

      <div style={{ marginTop: '1.75rem' }}>
        <PhotoUploader albumId={id} />
      </div>

      <PhotoGrid photos={photos ?? []} albumId={id} publicUrl={publicUrl} />
    </div>
  )
}
