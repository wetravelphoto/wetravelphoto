import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Keep private areas, client galleries and unpublished drafts out of
        // search results. /preview needs a session to load at all, but a
        // crawler should not be knocking on it either.
        disallow: ['/admin', '/api', '/gallery', '/preview'],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
