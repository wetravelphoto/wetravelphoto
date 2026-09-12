import { getSiteSettings } from '@/lib/site'
import { photoUrl } from '@/lib/images'
import { styleVars, type TypeStyles } from '@/lib/type-styles'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import './about.css'
import type { Metadata } from 'next'

export const revalidate = 300

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings()
  return {
    title: `${settings.about_heading || 'About'} — ${settings.site_title}`,
    description: settings.tagline ?? undefined,
  }
}

export default async function AboutPage() {
  const settings = await getSiteSettings()

  // Switching the page off should make it genuinely absent, not just unlinked
  if (settings.show_about === false) notFound()

  const styles = (settings.type_styles ?? {}) as TypeStyles
  const paragraphs = (settings.about_body ?? '').split('\n\n').filter(Boolean)

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <article className="about" data-side={settings.about_image_side} style={styleVars(styles, 'intro')}>
        {settings.about_image_path && (
          <div className="about-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl(settings.about_image_path)} alt="" />
          </div>
        )}

        <div className="about-panel">
          <div className="about-inner">
            {settings.about_eyebrow && <p className="about-eyebrow">{settings.about_eyebrow}</p>}

            <h1 className="about-heading">{settings.about_heading || 'About'}</h1>

            {paragraphs.length > 0 ? (
              <div className="about-body">
                {paragraphs.map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            ) : (
              <p className="about-body" style={{ color: 'var(--ink-mute)' }}>
                Nothing here yet.
              </p>
            )}

            {settings.about_cta_label && settings.about_cta_href && (
              <Link href={settings.about_cta_href} className="about-cta">
                {settings.about_cta_label}
              </Link>
            )}

          </div>
        </div>
      </article>

      <SiteFooter />
    </main>
  )
}
