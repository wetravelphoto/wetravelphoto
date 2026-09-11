import { createClient } from '@/lib/supabase/server'
import { updateAlbumSettings } from '@/app/actions/albums'
import { shareAlbumWithClient, unshareAlbumWithClient } from '@/app/actions/clients'
import AlbumSettingsEditor from '@/components/admin/AlbumSettingsEditor'
import ConfirmButton from '@/components/admin/ConfirmButton'
import { formatTripDate } from '@/lib/dates'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AlbumSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: album } = await supabase.from('albums').select('*').eq('id', id).single()
  const { data: photos } = await supabase
    .from('photos')
    .select('id, storage_path, taken_at')
    .eq('album_id', id)
    .order('sort_order', { ascending: true })

  const { data: allClients } = await supabase.from('clients').select('*').order('name')
  const { data: sharedWith } = await supabase
    .from('album_clients')
    .select('client_id, clients(id, name, email)')
    .eq('album_id', id)

  const sharedClientIds = new Set(sharedWith?.map((s) => s.client_id))
  const availableClients = allClients?.filter((c) => !sharedClientIds.has(c.id))
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

  // Collect tags already used across albums so they can be reused
  const { data: allAlbums } = await supabase.from('albums').select('tags')
  const tagSuggestions = Array.from(
    new Set((allAlbums ?? []).flatMap((a) => (a.tags as string[] | null) ?? []))
  ).sort()

  const dateSource = album?.trip_start_date ?? album?.created_at
  const dateLabel = formatTripDate(dateSource ?? null, album?.cover_date_format ?? 'month_year')

  return (
    <div>
      <p className="admin-crumb" style={{ marginBottom: '1.25rem' }}>
        <Link href="/admin/trips">Galleries</Link> / <Link href={`/admin/trips/${id}`}>{album?.title}</Link> / Settings
      </p>

      <form action={updateAlbumSettings.bind(null, id)} autoComplete="off">
        <AlbumSettingsEditor
          albumId={id}
          photos={photos ?? []}
          publicUrl={publicUrl}
          albumTitle={album?.title ?? ''}
          albumSlug={album?.slug ?? ''}
          albumLocation={album?.location ?? null}
          albumDescription={album?.description ?? null}
          albumDateLabel={dateLabel}
          customCoverPath={album?.cover_custom_path ?? null}
          coverVideoPath={album?.cover_video_path ?? null}
          privacyType={album?.privacy_type ?? 'public'}
          layoutStyle={album?.layout_style ?? 'masonry'}
          sortOrder={album?.sort_order ?? 'manual'}
          tripStartDate={album?.trip_start_date ?? null}
          initialTags={(album?.tags as string[] | null) ?? []}
          tagSuggestions={tagSuggestions}
          initialDateFormat={album?.cover_date_format ?? 'month_year'}
          initialShowTags={album?.show_tags ?? true}
          initialGalleryHero={album?.gallery_hero ?? false}
          initialDescAlign={album?.description_align ?? 'left'}
          initialDescScale={album?.description_scale ?? 1}
          initialCoverId={album?.cover_photo_id ?? null}
          initialFocalX={album?.cover_focal_x ?? 0.5}
          initialFocalY={album?.cover_focal_y ?? 0.5}
          initialOverlayType={album?.cover_overlay_type ?? 'none'}
          initialOverlayOpacity={album?.cover_overlay_opacity ?? 0.35}
          initialTitleEnabled={album?.cover_title_enabled ?? true}
          initialTitleText={album?.cover_title_text ?? ''}
          initialSubtitle={album?.cover_subtitle ?? ''}
          initialLayout={album?.cover_preset ?? 'anchor'}
          initialFont={album?.cover_font ?? 'Oswald'}
          initialScale={album?.cover_title_scale ?? 1}
          initialColor={album?.cover_title_color ?? '#FAF9F6'}
          initialShowLocation={album?.cover_show_location ?? false}
          initialShowDate={album?.cover_show_date ?? false}
          initialShowButton={album?.cover_show_button ?? false}
          initialButtonText={album?.cover_button_text ?? 'View gallery'}
        />
      </form>

      <div className="admin-panel" style={{ marginTop: '1.5rem', maxWidth: 600 }}>
        <h2 className="admin-h2">Shared with clients</h2>
        <p className="admin-meta" style={{ margin: '0 0 1rem' }}>
          Applies when privacy is &ldquo;Client only&rdquo;. Manage contacts on the{' '}
          <Link href="/admin/clients" style={{ borderBottom: '0.5px solid currentColor' }}>
            clients page
          </Link>
          .
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
          {sharedWith?.map((share) => {
            const client = share.clients as unknown as { id: string; name: string; email: string }
            return (
              <div key={share.client_id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                <span style={{ flex: 1 }}>
                  {client?.name} <span className="admin-meta">({client?.email})</span>
                </span>
                <form action={unshareAlbumWithClient.bind(null, id, share.client_id)}>
                  <ConfirmButton label="Remove" confirmLabel="Confirm" />
                </form>
              </div>
            )
          })}
          {sharedWith?.length === 0 && (
            <p className="admin-meta" style={{ margin: 0 }}>
              Not shared with anyone yet.
            </p>
          )}
        </div>

        {availableClients && availableClients.length > 0 && (
          <form action={shareAlbumWithClient.bind(null, id)} style={{ display: 'flex', gap: '0.5rem' }}>
            <select name="client_id" className="admin-select" style={{ marginTop: 0, flex: 1 }}>
              {availableClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} ({client.email})
                </option>
              ))}
            </select>
            <button type="submit" className="admin-btn">
              Share
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
