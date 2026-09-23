import type { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getSiteSettings, siteUrl } from '@/lib/site'
import { readPageSeo } from '@/lib/seo'
import { PAGES, sanitizeCustomPages, type PageSlug } from '@/lib/sections/pages'
import { currentSiteTenantId } from '@/lib/tenant'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrl()
  const supabase = await createClient()

  // A sitemap that listed another photographer's galleries under this site's
  // address would be telling Google they live here.
  const tenantId = await currentSiteTenantId()

  const { data: albums } = tenantId
    ? await supabase
        .from('albums')
        .select('slug, updated_at')
        .eq('tenant_id', tenantId)
        .eq('privacy_type', 'public')
    : { data: [] }

  const { data: posts } = tenantId
    ? await supabase
        .from('blog_posts')
        .select('slug, updated_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'published')
    : { data: [] }

  // The editor's pages, minus any the photographer has switched off or asked
  // search engines to leave out (Page settings → Search & sharing).
  const settings = await getSiteSettings()
  const listed: { page: PageSlug; changeFrequency: 'weekly' | 'monthly' | 'yearly'; priority: number }[] = [
    { page: 'home', changeFrequency: 'weekly', priority: 1 },
    { page: 'journal', changeFrequency: 'weekly', priority: 0.8 },
    { page: 'galleries', changeFrequency: 'weekly', priority: 0.8 },
    { page: 'shop', changeFrequency: 'weekly', priority: 0.6 },
    { page: 'about', changeFrequency: 'monthly', priority: 0.5 },
    { page: 'contact', changeFrequency: 'yearly', priority: 0.3 },
  ]

  const staticPages: MetadataRoute.Sitemap = listed
    .filter(({ page }) => !(page === 'about' && settings.show_about === false))
    .filter(({ page }) => !(page === 'shop' && !settings.show_shop))
    .filter(({ page }) => !readPageSeo(settings, page).noindex)
    .map(({ page, changeFrequency, priority }) => ({
      url: page === 'home' ? base : `${base}${PAGES[page].path}`,
      changeFrequency,
      priority,
    }))

  // The photographer's own pages, unless hidden from search.
  const ownPages: MetadataRoute.Sitemap = sanitizeCustomPages(settings.custom_pages)
    .filter((p) => !readPageSeo(settings, p.key).noindex)
    .map((p) => ({ url: `${base}/${p.slug}`, changeFrequency: 'monthly' as const, priority: 0.6 }))

  return [
    ...staticPages,
    ...ownPages,
    ...(albums ?? []).map((a) => ({
      url: `${base}/trips/${a.slug}`,
      lastModified: a.updated_at ? new Date(a.updated_at) : undefined,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    ...(posts ?? []).map((p) => ({
      url: `${base}/journal/${p.slug}`,
      lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ]
}
