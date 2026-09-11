import Icon from '@/components/SocialIcons'
import ContactForm from '@/components/ContactForm'

export type ContactSettings = {
  eyebrow: string | null
  heading: string | null
  intro: string | null
  note: string | null
  tagline: string | null
  imageUrl: string | null
  imageSide: string
  instagramUrl: string | null
  instagramHandle: string | null
  facebookUrl: string | null
  youtubeUrl: string | null
  email: string | null
}

/** Photo on one side, form on the other, with a contact row beneath. */
export default function ContactSection({
  settings,
  styleVars,
}: {
  settings: ContactSettings
  styleVars?: React.CSSProperties
}) {
  return (
    <section className="contact-split" data-side={settings.imageSide} style={styleVars}>
      {settings.imageUrl && (
        <div className="contact-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={settings.imageUrl} alt="" loading="lazy" />
          {settings.tagline && (
            <div className="contact-media-caption">
              <span className="contact-media-rule" />
              <p>{settings.tagline}</p>
            </div>
          )}
        </div>
      )}

      <div className="contact-panel">
        <div className="contact-panel-inner">
          {settings.eyebrow && <p className="contact-eyebrow">{settings.eyebrow}</p>}
          <h2 className="contact-heading">{settings.heading || 'Let’s connect'}</h2>
          {settings.intro && <p className="contact-copy">{settings.intro}</p>}

          <ContactForm note={settings.note} />

          <div className="contact-direct">
            {settings.instagramUrl && (
              <a href={settings.instagramUrl} target="_blank" rel="noopener">
                <Icon name="instagram" size={16} />
                {settings.instagramHandle
                  ? `@${settings.instagramHandle.replace('@', '')}`
                  : 'Instagram'}
              </a>
            )}

            {settings.facebookUrl && (
              <>
                <span className="contact-divider" />
                <a href={settings.facebookUrl} target="_blank" rel="noopener">
                  <Icon name="facebook" size={16} />
                  Facebook
                </a>
              </>
            )}

            {settings.youtubeUrl && (
              <>
                <span className="contact-divider" />
                <a href={settings.youtubeUrl} target="_blank" rel="noopener">
                  <Icon name="youtube" size={16} />
                  YouTube
                </a>
              </>
            )}

            {settings.email && (
              <>
                <span className="contact-divider" />
                <a href={`mailto:${settings.email}`}>
                  <Icon name="mail" size={16} />
                  {settings.email}
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
