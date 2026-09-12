import Link from 'next/link'
import { getSiteSettings } from '@/lib/site'
import { photoUrl } from '@/lib/images'
import NewsletterForm from '@/components/NewsletterForm'
import Icon from '@/components/SocialIcons'
import Logo from '@/components/Logo'
import { getFont } from '@/lib/fonts'

export default async function SiteFooter() {
  const settings = await getSiteSettings()

  const year = new Date().getFullYear()
  const owner = settings.owner_name || settings.site_title
  const copy = settings.footer_copy || `© ${year} ${owner}. All photographs are my own.`

  const footerFont = getFont(settings.footer_font || 'Karla')

  const chrome: React.CSSProperties = {
    ['--footer-font' as string]: footerFont.stack,
    ['--footer-weight' as string]: footerFont.weight,
    ['--footer-scale' as string]: String(settings.footer_scale ?? 1),
    ['--footer-scale-mobile' as string]: String(settings.footer_scale_mobile ?? 1),
    ['--footer-logo-h' as string]: `${settings.logo_footer_height ?? 130}px`,
    ['--footer-logo-h-mobile' as string]: `${settings.logo_footer_height_mobile ?? 90}px`,
  }

  return (
    <footer className="site-footer" data-align={settings.footer_align || 'left'} style={chrome}>
      <div className="footer-grid">
        <div className="footer-brand-col">
          <Logo
            variant="full"
            src={settings.logo_footer_path ? photoUrl(settings.logo_footer_path) : null}
            alt={settings.site_title}
            tone="light"
            height={0}
            className="footer-logo"
          />
          {settings.tagline && <p className="footer-tagline">{settings.tagline}</p>}

          <div className="footer-social">
            {settings.instagram_url && (
              <a href={settings.instagram_url} target="_blank" rel="noopener" aria-label="Instagram">
                <Icon name="instagram" size={17} />
              </a>
            )}
            {settings.facebook_url && (
              <a href={settings.facebook_url} target="_blank" rel="noopener" aria-label="Facebook">
                <Icon name="facebook" size={17} />
              </a>
            )}
            {settings.youtube_url && (
              <a href={settings.youtube_url} target="_blank" rel="noopener" aria-label="YouTube">
                <Icon name="youtube" size={17} />
              </a>
            )}
            {settings.email_public && (
              <a href={`mailto:${settings.email_public}`} aria-label="Email">
                <Icon name="mail" size={17} />
              </a>
            )}
          </div>
        </div>

        <nav className="footer-links">
          <p className="footer-col-head">Explore</p>
          <Link href="/">Home</Link>
          <Link href="/trips">{settings.nav_galleries_label || 'Galleries'}</Link>
          <Link href="/journal">{settings.nav_journal_label || 'Journal'}</Link>
          {settings.show_about !== false && (
            <Link href="/about">{settings.nav_about_label || 'About'}</Link>
          )}
          <Link href="/contact">{settings.nav_contact_label || 'Contact'}</Link>
        </nav>

        {settings.show_newsletter !== false && (
          <div className="footer-signup">
            <p className="footer-col-head">{settings.newsletter_heading || 'Field notes by email'}</p>
            <p className="footer-signup-copy">
              {settings.newsletter_body || 'An occasional note when new work goes up.'}
            </p>
            <NewsletterForm variant="footer" />
          </div>
        )}
      </div>

      <div className="footer-base">
        <span>{copy}</span>
        {settings.footer_note && <span className="footer-note">{settings.footer_note}</span>}
      </div>
    </footer>
  )
}
