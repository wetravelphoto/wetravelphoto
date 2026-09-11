import Link from 'next/link'
import { getSiteSettings } from '@/lib/site'
import NewsletterForm from '@/components/NewsletterForm'
import Icon from '@/components/SocialIcons'

export default async function SiteFooter({ showNewsletter = false }: { showNewsletter?: boolean }) {
  const settings = await getSiteSettings()

  return (
    <>
      {showNewsletter && settings.show_newsletter !== false && (
        <section className="newsletter">
          <div className="newsletter-inner">
            <div>
              <h2>{settings.newsletter_heading || 'New trips, straight to your inbox'}</h2>
              <p>
                {settings.newsletter_body ||
                  'An occasional note when a new set of photographs or a field story goes up.'}
              </p>
            </div>
            <NewsletterForm />
          </div>
        </section>
      )}

      <footer className="site-footer">
        <div className="footer-inner">
          <p className="footer-brand">WeTravelPhoto</p>

          <nav className="footer-nav">
            <Link href="/trips">Galleries</Link>
            <Link href="/journal">Journal</Link>
            <Link href="/about">About</Link>
            <Link href="/contact">Contact</Link>
          </nav>

          <div className="footer-social">
            {settings.instagram_url && (
              <a href={settings.instagram_url} target="_blank" rel="noopener" aria-label="Instagram">
                <Icon name="instagram" size={16} />
              </a>
            )}
            {settings.facebook_url && (
              <a href={settings.facebook_url} target="_blank" rel="noopener" aria-label="Facebook">
                <Icon name="facebook" size={16} />
              </a>
            )}
            {settings.youtube_url && (
              <a href={settings.youtube_url} target="_blank" rel="noopener" aria-label="YouTube">
                <Icon name="youtube" size={16} />
              </a>
            )}
          </div>

          <span className="footer-legal">© {new Date().getFullYear()} Gonzalo Mata</span>
        </div>
      </footer>
    </>
  )
}
