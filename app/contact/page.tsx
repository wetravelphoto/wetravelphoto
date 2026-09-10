import { getSiteSettings } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import ContactForm from '@/components/ContactForm'
import type { Metadata } from 'next'

export const revalidate = 300

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings()
  return { title: `Contact — ${settings.site_title}` }
}

export default async function ContactPage() {
  const settings = await getSiteSettings()

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 4rem', maxWidth: 560 }}>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', margin: '0 0 1.25rem', lineHeight: 1 }}>
          Contact
        </h1>

        {settings.contact_intro && (
          <p style={{ color: 'var(--ink-soft)', lineHeight: 1.8, margin: '0 0 2rem', maxWidth: '46ch' }}>
            {settings.contact_intro}
          </p>
        )}

        <ContactForm />
      </div>

      <SiteFooter />
    </main>
  )
}
