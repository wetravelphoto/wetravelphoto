import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import { currentLook, liveSections } from '@/lib/templates/store'

/**
 * THE UNDO POINT
 * ══════════════
 *
 * Every path that changes how the site looks writes one of these BEFORE it
 * changes anything — switching look, taking an update, reverting, and now
 * publishing from the canvas.
 *
 * It lives here rather than inside app/actions/templates.ts because the canvas
 * needed it too, and the alternative was a second copy. A second copy of the
 * only thing standing between a photographer and an unrecoverable change is
 * not a copy worth having: the two would drift, and the one that drifted would
 * be discovered by someone who had just lost their homepage.
 *
 * If the undo point cannot be written, the change does not happen. That is
 * deliberate and it is the whole contract.
 */
export type HistoryAction = 'apply' | 'update' | 'revert' | 'publish'

export async function recordHistory(input: {
  action: HistoryAction
  templateId: string | null
  templateSlug: string | null
  templateName: string | null
  version: number | null
  note?: string
}): Promise<void> {
  const supabase = await createClient()
  const settings = await getSiteSettings()
  const before = await liveSections('home')
  const current = await currentLook()

  const { error } = await supabase.from('site_template_history').insert({
    action: input.action,
    template_id: input.templateId,
    template_slug: input.templateSlug,
    template_name: input.templateName,
    version: input.version,
    sections_before: before,
    // Both halves, so an undo restores the colours as well as the order.
    // A row written before 2026-09-16 holds a bare type_styles map; revertTo
    // handles either shape.
    styles_before: {
      type_styles: settings.type_styles ?? {},
      tokens: settings.global_styles ?? {},
    },
    from_template_id: current.look?.id ?? null,
    from_version: current.version || null,
    note: input.note ?? null,
  })

  if (error) {
    // No history means no way back, and no way back is the one thing this
    // whole design exists to prevent. Refuse rather than proceed.
    //
    // A missing 'publish' value in the action check constraint lands here too,
    // which is why the message names the migration rather than only the error.
    throw new Error(
      `Could not save an undo point, so nothing was changed. (${error.message})` +
        (input.action === 'publish'
          ? ' If this mentions a check constraint, run db/migrations/2026-09-16_site_draft.sql.'
          : '')
    )
  }
}
