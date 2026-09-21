import Icon from '@/components/SocialIcons'
import ContactForm from '@/components/ContactForm'

export type ContactSettings = {
  /** Photograph beside the form, or the form centred on its own. */
  layout: 'split' | 'centered'
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
  editable = false,
}: {
  settings: ContactSettings
  styleVars?: React.CSSProperties
  /**
   * True only inside the editor's preview: tags the four pieces of writing
   * this section owns so each can be hovered and selected on its own. The
   * social links and the public email are the SITE's, not this section's, and
   * are deliberately not tagged — they are changed in Settings, and pretending
   * otherwise here would send someone to a field that does not exist.
   */
  editable?: boolean
}) {
  const field = (key: string) => (editable ? { 'data-field': key } : {})

  // The words, the form and the direct links — the same in both layouts, so
  // they are written once.
  const words = (
    <>
      {(settings.eyebrow || editable) && (
        <p className="contact-eyebrow" {...field('eyebrow')}>
          {settings.eyebrow}
        </p>
      )}
      <h2 className="contact-heading" {...field('heading')}>
        {settings.heading || 'Let’s connect'}
      </h2>
      {(settings.intro || editable) && (
        <p className="contact-copy" {...field('intro')}>
          {settings.intro}
        </p>
      )}

      <ContactForm note={settings.note} editable={editable} />

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
    </>
  )

  if (settings.layout === 'centered') {
    // The form and its words in the middle of the page, no photograph. The
    // Contact page's layout; `flex: 1` on the root (in CSS) lets it fill a
    // full-height page.
    return (
      <section
        className="contact-centred"
        style={styleVars}
        {...(editable ? { 'data-type-root': '' } : {})}
      >
        <div className="contact-panel-inner">{words}</div>
      </section>
    )
  }

  return (
    <section
      className="contact-split"
      data-side={settings.imageSide}
      style={styleVars}
      // In the editor: the layout attribute and the typography variables on
      // this element can be changed live. See LiveSpec in the registry.
      {...(editable ? { 'data-live': 'image_side', 'data-type-root': '' } : {})}
    >
      {settings.imageUrl && (
        <div className="contact-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={settings.imageUrl} alt="" loading="lazy" />
          {settings.tagline && (
            <div className="contact-media-caption">
              <span className="contact-media-rule" />
              <p {...field('tagline')}>{settings.tagline}</p>
            </div>
          )}
        </div>
      )}

      <div className="contact-panel">
        <div className="contact-panel-inner">{words}</div>
      </div>
    </section>
  )
}
