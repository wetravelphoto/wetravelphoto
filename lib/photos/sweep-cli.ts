import { createAdminClient } from '@/lib/supabase/admin'
import { r2Storage } from '@/lib/photos/storage'
import { GRACE_DAYS, SWEEP_ASSETS, SWEEP_BUDGET_MS, sweep, type SweepDb, type SweepReport } from '@/lib/photos/sweep'

/**
 * THE SWEEP COMMAND — the testable half of scripts/sweep-photos.ts
 * ════════════════════════════════════════════════════════════════
 *
 * Runs the photo sweeper by hand. An INTERNAL tool: no browser action, no
 * route, no page. The same `sweep()` the nightly drain calls, with the same
 * service-role client and the same bucket.
 *
 *   npx tsx --env-file=.env.local scripts/sweep-photos.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/sweep-photos.ts --apply
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * Two reasons, and the second is the one that mattered.
 *
 * It makes the sweeper OBSERVABLE: `--dry-run` reports exactly which assets
 * are due, which are held back and why, without touching storage or writing a
 * timestamp. There is no other way to see what the nightly run is about to
 * decide.
 *
 * And it makes the sweeper USABLE while natural cron execution is still
 * unconfirmed. That was an open coverage gap from the October 21 release and
 * the sweeper's whole value sits on top of the drain firing. With this, the
 * feature works whether or not it does.
 *
 * ── AND A CAVEAT ABOUT USING IT AS A CRON PROBE ─────────────────────────────
 *
 * It was claimed that, once deployed, `select count(*) from photo_assets where
 * sweep_checked_at is not null` would settle the cron question for free. That
 * is only true while NOTHING ELSE writes that column — and this command writes
 * it, on every `--apply` run. So a non-null `sweep_checked_at` proves that
 * SOMETHING swept, not that the drain did.
 *
 * To use it as a cron probe, either run this CLI only with `--dry-run` (which
 * writes nothing at all) or record when you ran it and exclude that window.
 * Codex raised this; it is written here rather than in a report because the
 * claim will be repeated by whoever reads the column next.
 *
 * ── THERE IS NO DEFAULT MODE, ON PURPOSE ────────────────────────────────────
 *
 * Exactly one of `--dry-run` or `--apply`, the same discipline
 * `rebuild-photo-usages` applies to `--tenant` / `--all`. This is the one
 * command on the platform that deletes a photographer's files; typing it with
 * no arguments must not be able to delete anything.
 *
 * Exit codes: 0 it ran and nothing went wrong; 1 it ran and something was held
 * back by a FAILURE rather than by a decision (a key the bucket refused, a
 * write that did not land, an unanswerable usage count, evidence that could
 * not be read); 2 the command was wrong or could not start, and no work was
 * done. An asset kept because something still references it is an ordinary
 * outcome and is not a failure.
 */

export const USAGE =
  'usage: sweep-photos --dry-run            (decide and report, change nothing)\n' +
  '       sweep-photos --apply              (delete the files that are due)\n' +
  '\n' +
  'options:\n' +
  `       --grace <days>                    days unreferenced before a purge (default ${GRACE_DAYS})\n` +
  `       --max <n>                         most assets to examine (default ${SWEEP_ASSETS})\n` +
  `       --budget <ms>                     time this run may spend (default ${SWEEP_BUDGET_MS})`

export type SweepCommand = {
  dryRun: boolean
  graceDays: number
  maxAssets: number
  budgetMs: number
}

export type Parsed = { ok: true; command: SweepCommand } | { ok: false; error: string }

const positive = (raw: string) => {
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * Pure. Exactly one of `--dry-run` or `--apply`; never a default.
 *
 * ── THE GRACE FLOOR ─────────────────────────────────────────────────────────
 *
 * An earlier version refused `--grace 0` and stopped thinking, which left
 * `--apply --grace 1` accepted: a one-day window defeats the thirty-day rule
 * just as completely as a zero-day one, and that is the whole protection
 * against a file being purged before anybody notices it was wanted. Codex
 * caught it.
 *
 * So the floor is the design's own `GRACE_DAYS`, and it applies **only to
 * `--apply`**. `--dry-run` may take any positive number, because it deletes
 * nothing and "what would be due if the window were seven days?" is a
 * legitimate question to ask of a report. A longer-than-default grace is
 * always allowed: more waiting is never the dangerous direction.
 */
export function parseArgs(argv: readonly string[]): Parsed {
  let dryRun: boolean | null = null
  let graceDays = GRACE_DAYS
  let maxAssets = SWEEP_ASSETS
  let budgetMs = SWEEP_BUDGET_MS

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--dry-run' || arg === '--apply') {
      const asked = arg === '--dry-run'
      if (dryRun !== null) {
        return { ok: false, error: dryRun === asked ? `${arg} was given twice.` : 'Give --dry-run OR --apply, not both.' }
      }
      dryRun = asked
      continue
    }
    if (arg === '--grace' || arg === '--max' || arg === '--budget') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return { ok: false, error: `${arg} needs a number.` }
      const n = positive(value)
      if (n === null) return { ok: false, error: `${arg} needs a whole number greater than zero, not "${value}".` }
      if (arg === '--grace') graceDays = n
      if (arg === '--max') maxAssets = n
      if (arg === '--budget') budgetMs = n
      i++
      continue
    }
    return { ok: false, error: `Unknown argument "${arg}".` }
  }

  if (dryRun === false && graceDays < GRACE_DAYS) {
    return {
      ok: false,
      error:
        `--apply will not accept a grace period under ${GRACE_DAYS} days (you gave ${graceDays}). ` +
        `An asset must be seen unreferenced twice, ${GRACE_DAYS} days apart, before its files go. ` +
        `Use --dry-run with a shorter window to see what WOULD be due.`,
    }
  }

  if (dryRun === null) {
    return { ok: false, error: 'Give --dry-run or --apply. There is no default, because this one deletes files.' }
  }
  return { ok: true, command: { dryRun, graceDays, maxAssets, budgetMs } }
}

/** What the command needs from the world. `serviceDeps()` is the real one. */
export type SweepDeps = {
  sweep: (command: SweepCommand) => Promise<SweepReport>
  out: (line: string) => void
}

/**
 * The outcomes that mean something went WRONG, as opposed to the sweeper
 * deciding not to purge. Named here rather than inferred from a prefix so
 * adding an outcome has to be thought about.
 */
const FAILURES = [
  'kept_storage_failed',
  'kept_write_failed',
  'kept_usage_check_failed',
  'kept_evidence_incomplete',
] as const

/*
 * AND `report.runErrors`, which is the other half.
 *
 * These counters are per-examined-asset. A failure of the RUN — the candidate
 * read, a site's evidence read, a batched bookkeeping write — examines no
 * asset, so it increments none of them. The first version computed the exit
 * code from these counters alone, which meant a total candidate-read failure
 * printed "examined 0" and exited 0: a sweep that did nothing at all,
 * reporting success. Codex found it.
 */

export function report(r: SweepReport, dryRun: boolean, out: (line: string) => void): number {
  out(
    `${dryRun ? 'dry run' : 'applied'}  examined ${r.examined}  purged ${r.purged}  ` +
      `files ${r.filesDeleted}  clocks started ${r.clocksStarted}  cleared ${r.clocksCleared}` +
      (r.outOfTime ? '  (out of time — more remains)' : '')
  )

  // Every outcome, in a stable order, so two runs can be compared by eye.
  for (const [outcome, count] of Object.entries(r.outcomes).sort(([a], [b]) => (a < b ? -1 : 1))) {
    out(`  ${outcome.padEnd(28)} ${count}`)
  }

  // The reasons, bounded. A hundred lines of "referenced by page_sections:…"
  // is not a report, so the detail is capped and the count says what was cut.
  const shown = r.notes.slice(0, 20)
  for (const note of shown) {
    out(`  · ${note.assetId}  ${note.outcome}${note.detail ? `  ${note.detail}` : ''}`)
  }
  if (r.notes.length > shown.length) out(`  · … and ${r.notes.length - shown.length} more`)

  for (const problem of r.runErrors) out(`  ! ${problem}`)

  const failures = FAILURES.reduce((sum, key) => sum + (r.outcomes[key] ?? 0), 0)
  if (failures > 0) out(`${failures} asset(s) were held back by a failure rather than by a decision.`)
  if (r.runErrors.length > 0) {
    out(`${r.runErrors.length} failure(s) of the run itself — this sweep did not do what it was asked.`)
  }
  return failures > 0 || r.runErrors.length > 0 ? 1 : 0
}

/** Runs a parsed command. Returns the exit code. */
export async function runSweep(command: SweepCommand, deps: SweepDeps): Promise<number> {
  let result: SweepReport
  try {
    result = await deps.sweep(command)
  } catch (e) {
    // `sweep()` is written not to throw; this is here so that if it ever does,
    // the command says so instead of printing a stack over a half-finished run.
    deps.out(`the sweep stopped: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
  return report(result, command.dryRun, deps.out)
}

/**
 * The real dependencies: the service-role client (which throws without
 * SUPABASE_SERVICE_ROLE_KEY) and the real bucket.
 */
export function serviceDeps(out: (line: string) => void = console.log): SweepDeps {
  const admin = createAdminClient()
  return {
    sweep: (command) =>
      sweep(admin as unknown as SweepDb, r2Storage, {
        now: new Date(),
        graceDays: command.graceDays,
        maxAssets: command.maxAssets,
        budgetMs: command.budgetMs,
        dryRun: command.dryRun,
      }),
    out,
  }
}

/**
 * The whole command: parse, and only then build the dependencies and run.
 * Nothing touches a database or a bucket until the arguments are valid.
 */
export async function main(
  argv: readonly string[],
  makeDeps: () => SweepDeps = () => serviceDeps(),
  err: (line: string) => void = console.error
): Promise<number> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    err(`${parsed.error}\n${USAGE}`)
    return 2
  }
  let deps: SweepDeps
  try {
    deps = makeDeps()
  } catch (e) {
    err(e instanceof Error ? e.message : String(e))
    return 2
  }
  return runSweep(parsed.command, deps)
}
