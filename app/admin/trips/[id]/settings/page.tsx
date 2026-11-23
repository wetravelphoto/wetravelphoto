import { createClient } from '@/lib/supabase/server'
import { updateAlbumSettings } from '@/app/actions/albums'
import AlbumSettingsEditor from '@/components/admin/AlbumSettingsEditor'
import { siteUrl } from '@/lib/site'
import { galleryEmailConfigured } from '@/lib/gallery-email'
import type { SharedClient } from '@/lib/clients/share'
import { headers } from 'next/headers'
import Link from 'next/link'
import { requireEditor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/*
 * The album's settings. Since client-gallery-v2 the "Private links" and
 * "Shared with clients" panels are no longer on this page around the form:
 * privacy, links and clients all live in the editor's Sharing tab.
 */
export default async function AlbumSettingsPage({ params }: { params: Promise<{ id: string }> }) {
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
    .select('id, storage_path, derivatives, taken_at, width, height')
    .eq('tenant_id', tenantId)
    .eq('album_id', id)
    .order('sort_order', { ascending: true })

  const { data: allClients } = await supabase
    .from('clients')
    .select('id, name, email')
    .eq('tenant_id', tenantId)
    .order('name')
  const { data: sharedWith } = await supabase
    .from('album_clients')
    // access_token so the Sharing tab can copy and email the link that
    // actually opens this album for each client.
    .select('client_id, clients(id, name, email, access_token)')
    .eq('album_id', id)

  const sharedClients: SharedClient[] = (sharedWith ?? [])
    .map((row) => row.clients as unknown as { id: string; name: string; email: string; access_token: string } | null)
    .filter((c): c is { id: string; name: string; email: string; access_token: string } => !!c?.id)
    .map((c) => ({ id: c.id, name: c.name ?? 'Client', email: c.email ?? '', token: c.access_token ?? '' }))
  const sharedIds = new Set(sharedClients.map((c) => c.id))
  const contacts = (allClients ?? [])
    .filter((c) => !sharedIds.has(c.id as string))
    .map((c) => ({ id: c.id as string, name: (c.name as string) ?? '', email: (c.email as string) ?? '' }))

  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

  // Collect tags already used across albums so they can be reused
  const { data: allAlbums } = await supabase.from('albums').select('tags').eq('tenant_id', tenantId)
  const tagSuggestions = Array.from(
    new Set((allAlbums ?? []).flatMap((a) => (a.tags as string[] | null) ?? []))
  ).sort()

  // The photographer's name, as the site calls itself — on the covers and in the email.
  const { data: settings } = await supabase.from('site_settings').select('site_title').eq('tenant_id', tenantId).maybeSingle()

  // A custom cover's own size, for orientation: its canonical asset knows it.
  let customCoverSize: { width: number | null; height: number | null } | null = null
  if (album?.cover_custom_path) {
    const { data: asset } = await supabase
      .from('photo_assets')
      .select('width, height')
      .eq('tenant_id', tenantId)
      .eq('display_path', album.cover_custom_path)
      .maybeSingle()
    if (asset) customCoverSize = { width: (asset.width as number | null) ?? null, height: (asset.height as number | null) ?? null }
  }

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
          siteTitle={(settings?.site_title as string | null) ?? ''}
          albumTitle={album?.title ?? ''}
          albumSlug={album?.slug ?? ''}
          albumLocation={album?.location ?? null}
          albumDescription={album?.description ?? null}
          albumCreatedAt={album?.created_at ?? null}
          customCoverPath={album?.cover_custom_path ?? null}
          customCoverSize={customCoverSize}
          coverVideoPath={album?.cover_video_path ?? null}
          privacyType={album?.privacy_type ?? 'public'}
          layoutStyle={album?.layout_style ?? 'grid'}
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
          initialZoom={album?.cover_zoom ?? null}
          initialBackground={album?.cover_background ?? null}
          initialSecondaryId={album?.cover_secondary_photo_id ?? null}
          initialOverlayType={album?.cover_overlay_type ?? 'none'}
          initialOverlayOpacity={album?.cover_overlay_opacity ?? 0.35}
          initialTitleEnabled={album?.cover_title_enabled ?? true}
          initialTitleText={album?.cover_title_text ?? ''}
          initialSubtitle={album?.cover_subtitle ?? ''}
          initialLayout={album?.cover_preset ?? 'anchor'}
          initialFont={album?.cover_font ?? 'Oswald'}
          initialScale={album?.cover_title_scale ?? 1}
          initialColor={album?.cover_title_color ?? '#FAF9F6'}
          initialAllowDownloads={album?.allow_downloads === true}
          initialShowLocation={album?.cover_show_location ?? false}
          initialShowDate={album?.cover_show_date ?? false}
          initialShowButton={album?.cover_show_button ?? false}
          initialButtonText={album?.cover_button_text ?? 'View gallery'}
          origin={await requestOrigin()}
          sharedClients={sharedClients}
          contacts={contacts}
          emailConfigured={galleryEmailConfigured()}
        />
      </form>
    </div>
  )
}

/**
 * The origin links are built on: from the request rather than
 * NEXT_PUBLIC_SITE_URL, which is unset often enough that the fallback would
 * quietly offer a localhost link to send someone. siteUrl() stays as the
 * backstop. Which link each privacy setting sends is the Sharing tab's
 * (components/admin/album/SharingPanel.tsx): public, unlisted and password
 * share the album's own address; client only has none — one link per client,
 * belonging to the person, opening every album shared with them.
 */
async function requestOrigin(): Promise<string> {
  const host = (await headers()).get('host')
  if (!host) return await siteUrl()

  const scheme = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https'
  return `${scheme}://${host}`
}
