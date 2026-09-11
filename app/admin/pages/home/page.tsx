import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import { updateHomepage } from '@/app/actions/site'
import HomepageEditor from '@/components/admin/HomepageEditor'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function HomePageEditor() {
  const settings = await getSiteSettings()
  const supabase = await createClient()

  const { data: posts } = await supabase
    .from('blog_posts')
    .select('id, title, category, featured_custom_path')
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  const { count: instagramCount } = await supabase
    .from('instagram_media')
    .select('id', { count: 'exact', head: true })

  const { data: albumRows, count: galleryCount } = await supabase
    .from('albums')
    .select('id, title, location, cover_photo_id, cover_custom_path, photos!photos_album_id_fkey(id, storage_path)', {
      count: 'exact',
    })
    .eq('privacy_type', 'public')
    .order('created_at', { ascending: false })
    .limit(6)

  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

  const galleries = (albumRows ?? []).map((album) => {
    const photos = (album.photos ?? []) as { id: string; storage_path: string }[]
    const cover = album.cover_custom_path
      ? album.cover_custom_path
      : (photos.find((p) => p.id === album.cover_photo_id) ?? photos[0])?.storage_path

    return {
      id: album.id as string,
      title: album.title as string,
      location: (album.location as string) ?? null,
      coverPath: cover ?? null,
    }
  })

  const options = (posts ?? []).map((post) => ({
    id: post.id as string,
    title: post.title as string,
    category: (post.category as string) ?? null,
    imagePath: (post.featured_custom_path as string) ?? null,
  }))

  return (
    <div>
      <p className="admin-crumb">
        <Link href="/admin/pages">← Pages</Link>
      </p>

      <div className="page-editor-head">
        <div>
          <h1 className="admin-h1">Homepage</h1>
          <p className="admin-meta" style={{ margin: '0.35rem 0 0' }}>
            Sections appear in this order on the live page.
          </p>
        </div>
        <Link href="/" target="_blank" className="admin-btn admin-btn-ghost admin-btn-sm">
          View ↗
        </Link>
      </div>

      <form action={updateHomepage} autoComplete="off">
        <HomepageEditor
          posts={options}
          publicUrl={publicUrl}
          galleryCount={galleryCount ?? 0}
          galleries={galleries}
          instagramCount={instagramCount ?? 0}
          instagramConnected={!!settings.instagram_token}
          settings={{
            featured_post_ids: settings.featured_post_ids ?? [],
            hero_titles: settings.hero_titles ?? {},
            hero_subtitles: settings.hero_subtitles ?? {},
            hero_focal: settings.hero_focal ?? {},
            hero_title_position: settings.hero_title_position ?? 'center',
            hero_show_mark: settings.hero_show_mark !== false,
            hero_mode: settings.hero_mode ?? 'stories',
            hero_image_path: settings.hero_image_path,
            hero_fixed_title: settings.hero_fixed_title,
            hero_fixed_subtitle: settings.hero_fixed_subtitle,
            hero_fixed_cta_label: settings.hero_fixed_cta_label,
            hero_fixed_cta_href: settings.hero_fixed_cta_href,
            hero_fixed_focal: settings.hero_fixed_focal ?? {},
            type_styles: settings.type_styles ?? {},
            hero_kicker: settings.hero_kicker,
            show_intro: settings.show_intro,
            intro_kicker: settings.intro_kicker,
            intro_heading: settings.intro_heading,
            intro_body: settings.intro_body,
            intro_image_path: settings.intro_image_path,
            intro_image_side: settings.intro_image_side,
            show_galleries: settings.show_galleries,
            carousel_heading: settings.carousel_heading,
            show_journal: settings.show_journal,
            journal_heading: settings.journal_heading,
            journal_count: settings.journal_count,
            show_contact_section: settings.show_contact_section,
            contact_heading: settings.contact_heading,
            show_instagram: settings.show_instagram,
            instagram_heading: settings.instagram_heading,
            contact_eyebrow: settings.contact_eyebrow,
            contact_intro: settings.contact_intro,
            contact_note: settings.contact_note,
            contact_tagline: settings.contact_tagline,
            contact_image_path: settings.contact_image_path,
            contact_image_side: settings.contact_image_side,
            footer_note: settings.footer_note,
          }}
        />

      </form>
    </div>
  )
}
