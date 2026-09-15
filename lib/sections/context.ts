import { createClient } from '@/lib/supabase/server'
import { attachCovers } from '@/lib/album-covers'
import { getInstagramFeed } from '@/lib/instagram'
import { neededData, type LoadedSection } from '@/lib/sections/load'
import { num } from '@/lib/sections/registry'
import type { SiteSettings } from '@/lib/site'
import type { TypeStyles } from '@/lib/type-styles'

export type PostRow = {
  id: string
  slug: string
  title: string
  category: string | null
  excerpt: string | null
  featured_custom_path: string | null
  published_at: string | null
}

export type AlbumRow = {
  id: string
  slug: string
  title: string
  location: string | null
  trip_start_date: string | null
  created_at: string
  cover_photo_id: string | null
  cover_custom_path: string | null
  cover_video_path: string | null
  cover_focal_x: number | null
  cover_focal_y: number | null
  cover_title_enabled: boolean | null
  cover_title_text: string | null
  cover_subtitle: string | null
  cover_preset: string | null
  cover_font: string | null
  cover_title_scale: number | null
  cover_title_color: string | null
  cover_overlay_type: string | null
  cover_overlay_opacity: number | null
  cover_show_location: boolean | null
  cover_show_date: boolean | null
  cover_date_format: string | null
}

type AlbumWithCover = AlbumRow & { coverUrl: string | null; coverSrcSet?: string }

export type SectionContext = {
  settings: SiteSettings
  styles: TypeStyles
  posts: PostRow[]
  albums: AlbumWithCover[]
  albumError: string | null
  instagram: Awaited<ReturnType<typeof getInstagramFeed>>
}

/**
 * Fetches only what the visible sections actually need, in parallel.
 *
 * The queries are the same ones the old homepage ran unconditionally; the
 * difference is that hiding the journal now also stops the posts query, and a
 * page with neither galleries nor stories makes no content query at all.
 */
export async function buildContext(
  sections: LoadedSection[],
  settings: SiteSettings
): Promise<SectionContext> {
  const needs = neededData(sections)
  const supabase = await createClient()

  const instagramCount = Math.max(
    3,
    ...sections
      .filter((s) => s.visible && s.type === 'instagram')
      .map((s) => num(s.settings, 'count', 9))
  )

  const [postResult, albumResult, instagram] = await Promise.all([
    needs.has('posts')
      ? supabase
          .from('blog_posts')
          .select('id, slug, title, category, excerpt, featured_custom_path, published_at')
          .eq('status', 'published')
          .order('published_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),

    needs.has('albums')
      ? // No photo embed here. Fetching every photo of every gallery to pick
        // one cover each is what made this page time out and 502.
        supabase
          .from('albums')
          .select('*')
          .eq('privacy_type', 'public')
          // Same order as /trips and the admin grid — set by dragging in
          // /admin/trips
          .order('display_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),

    needs.has('instagram') && settings.show_instagram
      ? getInstagramFeed(instagramCount)
      : Promise.resolve([]),
  ])

  const albums = needs.has('albums')
    ? await attachCovers((albumResult.data ?? []) as unknown as AlbumRow[])
    : []

  return {
    settings,
    styles: (settings.type_styles ?? {}) as TypeStyles,
    posts: (postResult.data ?? []) as PostRow[],
    albums: albums as AlbumWithCover[],
    albumError: albumResult.error?.message ?? null,
    instagram,
  }
}
