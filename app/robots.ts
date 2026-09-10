import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Keep private areas and client galleries out of search results
        disallow: ['/admin', '/api', '/gallery'],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
