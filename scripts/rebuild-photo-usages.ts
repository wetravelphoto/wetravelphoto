/**
 * Rebuilds photo_usages from the saved documents — one site, or every site.
 *
 *   npx tsx --env-file=.env.local scripts/rebuild-photo-usages.ts --tenant <uuid>
 *   npx tsx --env-file=.env.local scripts/rebuild-photo-usages.ts --all
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Internal only.
 * Everything it does is in lib/photos/rebuild-cli.ts; this file only runs it.
 */
import { main } from '../lib/photos/rebuild-cli'

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.stack : String(e))
    process.exit(2)
  }
)
