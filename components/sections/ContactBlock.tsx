import { photoUrl } from '@/lib/images'
import { sectionVars } from '@/lib/type-styles'
import { str, type SectionSettings } from '@/lib/sections/registry'
import type { SectionContext } from '@/lib/sections/context'
import ContactSection from '@/components/ContactSection'

export default function ContactBlock({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  const image = str(settings, 'image_path')

  return (
    <ContactSection
      editable={ctx.editable}
      styleVars={sectionVars('contact', settings, ctx.styles)}
      settings={{
        layout: str(settings, 'layout') === 'centered' ? 'centered' : 'split',
        eyebrow: str(settings, 'eyebrow'),
        heading: str(settings, 'heading'),
        intro: str(settings, 'intro'),
        note: str(settings, 'note'),
        tagline: str(settings, 'tagline'),
        imageUrl: image ? photoUrl(image) : null,
        imageSide: (str(settings, 'image_side') ?? 'left') as 'left' | 'right',
        // Social links and the public address are the site's, not this
        // section's — one place to change them, every page follows.
        instagramUrl: ctx.settings.instagram_url,
        instagramHandle: ctx.settings.instagram_handle,
        facebookUrl: ctx.settings.facebook_url,
        youtubeUrl: ctx.settings.youtube_url,
        email: ctx.settings.email_public,
      }}
    />
  )
}
