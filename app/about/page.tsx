import { getSiteSettings } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import type { Metadata } from 'next'

export const revalidate = 300

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings()
  return {
    title: `About — ${settings.site_title}`,
    description: settings.tagline ?? undefined,
  }
}

export default async function AboutPage() {
  const settings = await getSiteSettings()

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 4rem', maxWidth: 680 }}>
        <p className="eyebrow" style={{ margin: '0 0 0.75rem' }}>
          {settings.tagline}
        </p>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', margin: '0 0 2rem', lineHeight: 1 }}>
          {settings.about_heading || 'About'}
        </h1>

        <div className="prose">
          {settings.about_body ? (
            settings.about_body.split('\n\n').map((para, i) => <p key={i}>{para}</p>)
          ) : (
            <p style={{ color: 'var(--ink-mute)' }}>
              Nothing here yet — add your story from the site settings page in the admin.
            </p>
          )}
        </div>

        {(settings.instagram_url || settings.email_public) && (
          <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            {settings.instagram_url && (
              <a href={settings.instagram_url} target="_blank" rel="noopener" className="underline-link" style={{ fontSize: '0.82rem' }}>
                Instagram
              </a>
            )}
            {settings.email_public && (
              <a href={`mailto:${settings.email_public}`} className="underline-link" style={{ fontSize: '0.82rem' }}>
                {settings.email_public}
              </a>
            )}
          </div>
        )}
      </div>

      <SiteFooter />
    </main>
  )
}
