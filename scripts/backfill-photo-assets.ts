/**
 * Gives every photograph uploaded before P2 its photo_assets row — one site,
 * or every site. A dry run unless --apply is given.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-photo-assets.ts --tenant <uuid> [--apply] [--manifest <file>]
 *   npx tsx --env-file=.env.local scripts/backfill-photo-assets.ts --all          [--apply] [--manifest <file>]
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the R2 read
 * credentials. Internal only. Everything it does is in lib/photos/backfill-cli.ts;
 * this file only runs it. Afterwards, separately: scripts/rebuild-photo-usages.ts.
 */
import { readFileSync } from 'node:fs'
import { main } from '../lib/photos/backfill-cli'

main(process.argv.slice(2), (path) => readFileSync(path, 'utf8')).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.stack : String(e))
    process.exit(2)
  }
)
