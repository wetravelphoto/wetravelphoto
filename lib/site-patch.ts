import { createClient } from '@/lib/supabase/server'
import { requireEditor } from '@/lib/auth'

/**
 * Pulls the column name out of a Postgres "column ... does not exist" error.
 * PostgREST phrases it a couple of ways depending on where it noticed.
 */
export function missingColumn(message: string): string | null {
  const quoted = message.match(
    /column ["']?(?:[\w.]*\.)?([\w]+)["']? (?:of relation [^ ]+ )?does not exist/i
  )
  if (quoted) return quoted[1]

  const found = message.match(/Could not find the '([\w]+)' column/i)
  return found ? found[1] : null
}

/**
 * Writes to site_settings, dropping any column the database does not have.
 *
 * A settings form writes whatever the deployed code knows about, which can be
 * ahead of the database — a migration not yet run, or a tenant a release
 * behind. Rejecting the lot would lose the fields that *are* valid and show a
 * server error for what is really one missing column, so the unknown ones are
 * dropped and the rest is saved.
 */
export async function patchSiteSettings(values: Record<string, unknown>): Promise<void> {
  // The editor's own site — never "row 1". Row-level security would refuse
  // another site's row anyway, but silently: the save would report success and
  // change nothing. Saying which row is meant makes that impossible.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()
  const payload = { ...values }

  for (let attempt = 0; attempt < 12; attempt++) {
    const { error } = await supabase.from('site_settings').update(payload).eq('tenant_id', tenantId)
    if (!error) return

    const column = missingColumn(error.message)
    if (!column || !(column in payload)) throw new Error(error.message)

    console.warn(
      `[settings] site_settings.${column} is missing — saving without it. ` +
        'Run the outstanding migration in db/migrations.'
    )

    delete payload[column]
    if (Object.keys(payload).length === 0) return
  }
}
