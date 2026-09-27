import { num, str, type SectionSettings } from '@/lib/sections/registry'
import type { SectionContext } from '@/lib/sections/context'
import { textStyleFor } from '@/lib/sections/text-style'
import { allFonts } from '@/lib/type-styles'
import TextFonts from '@/components/sections/TextFonts'
import InstagramFeed from '@/components/home/InstagramFeed'

export default function InstagramSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  // The token still lives on site_settings — it is a connection, not a design
  // choice, and belongs in Settings rather than on the page.
  if (!ctx.settings.show_instagram) return null

  return (
    <>
      <TextFonts names={allFonts('instagram', settings, ctx.styles)} />
      <InstagramFeed
        posts={ctx.instagram.slice(0, num(settings, 'count', 9))}
        heading={str(settings, 'heading')}
        handle={ctx.settings.instagram_handle}
        headingStyle={textStyleFor(settings, 'heading')}
        editable={ctx.editable}
      />
    </>
  )
}
