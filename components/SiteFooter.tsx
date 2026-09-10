import Link from 'next/link'
import { getSiteSettings } from '@/lib/site'
import NewsletterForm from '@/components/NewsletterForm'

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
          <div>
            <p className="footer-brand">WeTravelPhoto</p>
            <p style={{ fontSize: '0.85rem', lineHeight: 1.7, margin: 0, maxWidth: '30ch', opacity: 0.75 }}>
              {settings.tagline || 'Travel photography and field notes.'}
            </p>
          </div>

          <div className="footer-col">
            <h3>Explore</h3>
            <Link href="/">Home</Link>
            <Link href="/trips">Trips</Link>
            <Link href="/journal">Journal</Link>
          </div>

          <div className="footer-col">
            <h3>Get in touch</h3>
            <Link href="/contact">Contact</Link>
            {settings.email_public && <a href={`mailto:${settings.email_public}`}>{settings.email_public}</a>}
            {settings.instagram_url && (
              <a href={settings.instagram_url} target="_blank" rel="noopener">
                Instagram
              </a>
            )}
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} WeTravelPhoto. All photographs by Gonzalo Mata.</span>
        </div>
      </footer>
    </>
  )
}
