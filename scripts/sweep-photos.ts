/**
 * Runs the photo sweeper by hand. OBSERVATION ONLY: physical deletion is
 * disabled by construction, and `--apply` is refused (exit 2).
 *
 *   npx tsx --env-file=.env.local scripts/sweep-photos.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/sweep-photos.ts --record
 *
 * There is no default mode: without --dry-run or --record it refuses and does
 * nothing. `--dry-run` observes and reports and writes nothing. `--record`
 * also writes the sweeper's own two bookkeeping timestamps. Neither can reach
 * the bucket.
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
