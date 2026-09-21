import ContactForm from '@/components/ContactForm'
import { str, type SectionSettings } from '@/lib/sections/registry'
import { editable } from '@/lib/sections/editable'
import type { SectionContext } from '@/lib/sections/context'

/**
 * A heading, a few lines, and the message form.
 *
 * The markup app/contact/page.tsx used to draw by hand, moved into a section so
 * the Contact page can be edited in the canvas. Its words are its own now: the
 * old page borrowed the homepage contact section's intro line, so changing one
 * silently changed the other.
 */
export default function ContactFormSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  const heading = str(settings, 'heading')
  const intro = str(settings, 'intro')

  return (
    <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 4rem', maxWidth: 560 }}>
      {(heading || ctx.editable) && (
        <h1
          className="display"
          style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', margin: '0 0 1.25rem', lineHeight: 1 }}
          {...editable(ctx, 'heading')}
        >
          {heading}
        </h1>
      )}

      {(intro || ctx.editable) && (
        <p
          style={{ color: 'var(--ink-soft)', lineHeight: 1.8, margin: '0 0 2rem', maxWidth: '46ch' }}
          {...editable(ctx, 'intro')}
        >
          {intro}
        </p>
      )}

      <ContactForm />
    </div>
  )
}
