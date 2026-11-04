/**
 * Runs the photo sweeper by hand — the only command on the platform that
 * deletes a photographer's stored files.
 *
 *   npx tsx --env-file=.env.local scripts/sweep-photos.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/sweep-photos.ts --apply
 *
 * There is no default mode: without --dry-run or --apply it refuses and does
 * nothing. `--dry-run` decides and reports, touching neither the bucket nor a
 * timestamp.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Internal only.
 * Everything it does is in lib/photos/sweep-cli.ts; this file only runs it.
 */
import { main } from '../lib/photos/sweep-cli'

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.stack : String(e))
    process.exit(2)
  }
)
