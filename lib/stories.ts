import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * PUBLISHED STORIES, AS A VISITOR MAY READ THEM
 * ═════════════════════════════════════════════
 *
 * The public reads of blog_posts, in one place: the journal and sequence
 * sections' cards, a story's own page and its "keep reading" row. Every one is
 * scoped to the site by name and to `status = published` — the table's public
 * read policy is per row, and a platform admin passes every row-level check,
 * so these two filters are what keep another site's stories and anybody's
 * drafts off a public page.
 *
 * Callers pass the site they resolved from the request's Host
 * (lib/photos/public.ts). Nothing here reads a photograph's metadata.
 *
 * Each returns PostgREST's whole reply, error included, so the caller can tell
 * a failed read from a site with nothing published — and never acts on data
 * that came back beside an error.
 */

/** The columns a story card draws. */
const CARD_COLUMNS = 'id, slug, title, category, excerpt, featured_custom_path, published_at, byline'

export type StoryCardRow = {
  id: string
  slug: string
  title: string
  category: string | null
  excerpt: string | null
  featured_custom_path: string | null
  published_at: string | null
  byline: string | null
}

/** Every published story of the site, newest first. */
export async function publishedStoryRows(tenantId: string) {
  const supabase = await createClient()
  return supabase
    .from('blog_posts')
    .select(CARD_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
}

/** One published story by its address, with the gallery it came from. */
export async function publishedStoryBySlug(tenantId: string, slug: string) {
  // Slugs are unique per SITE, not globally: two photographers may both have
  // written about Iceland.
  const supabase = await createClient()
  return supabase
    .from('blog_posts')
    .select('*, albums(title, slug)')
    .eq('tenant_id', tenantId)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
}

/** Up to four other published stories, for "keep reading". */
export async function relatedStoryRows(tenantId: string, excludeId: string) {
  const supabase = await createClient()
  return supabase
    .from('blog_posts')
    .select('id, slug, title, category, excerpt, featured_custom_path')
    .eq('tenant_id', tenantId)
    .eq('status', 'published')
    .neq('id', excludeId)
    .order('published_at', { ascending: false })
    .limit(4)
}
