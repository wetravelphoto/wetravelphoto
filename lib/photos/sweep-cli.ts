import { createAdminClient } from '@/lib/supabase/admin'
import { GRACE_DAYS, SWEEP_ASSETS, SWEEP_BUDGET_MS, sweep, type SweepDb, type SweepReport } from '@/lib/photos/sweep'

/**
 * THE SWEEP COMMAND — the testable half of scripts/sweep-photos.ts
 * ════════════════════════════════════════════════════════════════
 *
 * Runs the photo sweeper by hand. An INTERNAL tool: no browser action, no
 * route, no page. The same `sweep()` the nightly drain calls, with the same
 * service-role client. It is given NO bucket, because `sweep()` takes none.
 *
 *   npx tsx --env-file=.env.local scripts/sweep-photos.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/sweep-photos.ts --record
 *
 * ── OBSERVATION ONLY (Work, gate P6-20261121-sweeper-application-01) ───────
 *
 * Physical deletion is disabled by construction (see `lib/photos/sweep.ts`).
 * `--apply`, which used to delete the files that were due, is REFUSED with
 * exit 2 and says why. Retyping it is not a way back. `--record` writes the
 * sweeper's own bookkeeping columns and nothing else, exactly as the drain
 * does. `--dry-run` writes nothing.
 *
 * The thirty-day floor on `--apply` went with it. Grace now changes only
 * which assets are REPORTED as `purge_deferred` rather than
 * `waiting_out_grace`. Both outcomes write the same timestamp, so no window
 * can cause anything to happen.
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
 * it, on every `--record` run. So a non-null `sweep_checked_at` proves that
 * SOMETHING swept, not that the drain did.
 *
 * To use it as a cron probe, either run this CLI only with `--dry-run` (which
 * writes nothing at all) or record when you ran it and exclude that window.
 * Codex raised this; it is written here rather than in a report because the
 * claim will be repeated by whoever reads the column next.
 *
 * ── THERE IS NO DEFAULT MODE, ON PURPOSE ────────────────────────────────────
 *
 * Exactly one of `--dry-run` or `--record`, the same discipline
 * `rebuild-photo-usages` applies to `--tenant` / `--all`. Typing it with no
 * arguments must not be able to write anything.
 *
 * Exit codes: 0 it ran and nothing went wrong; 1 it ran and something was held
 * back by a FAILURE rather than by a decision (an unanswerable usage count,
 * evidence that could not be read, a bookkeeping write that did not land);
 * 2 the command was wrong or could not start, and no work was done. That
 * includes `--apply`. An asset kept because something still references it, or
 * one whose purge is deferred, is an ordinary outcome and not a failure.
 */

export const USAGE =
  'usage: sweep-photos --dry-run            (observe and report, change nothing)\n' +
  '       sweep-photos --record             (observe and write the sweeper\'s own timestamps)\n' +
  '\n' +
  'Physical deletion is disabled in this build; --apply is refused.\n' +
  '\n' +
  'options:\n' +
  `       --grace <days>                    days unreferenced before an asset is reported purge_deferred (default ${GRACE_DAYS})\n` +
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

/** Why `--apply` is refused. Exported so the suite can match it exactly. */
export const APPLY_REFUSED =
  '--apply is refused: physical deletion is disabled in this build (Work gate ' +
  'P6-20261121-sweeper-application-01, B1/B2). Use --dry-run or --record to observe.'

/**
 * Pure. Exactly one of `--dry-run` or `--record`; never a default; `--apply`
 * refused wherever it appears.
 */
export function parseArgs(argv: readonly string[]): Parsed {
  let dryRun: boolean | null = null
  let graceDays = GRACE_DAYS
  let maxAssets = SWEEP_ASSETS
  let budgetMs = SWEEP_BUDGET_MS

  // Checked before anything else, so no combination of flags can get past it.
  if (argv.includes('--apply')) return { ok: false, error: APPLY_REFUSED }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--dry-run' || arg === '--record') {
      const asked = arg === '--dry-run'
      if (dryRun !== null) {
        return { ok: false, error: dryRun === asked ? `${arg} was given twice.` : 'Give --dry-run OR --record, not both.' }
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

  if (dryRun === null) {
    return { ok: false, error: 'Give --dry-run or --record. There is no default.' }
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
 * adding an outcome has to be thought about. (`kept_storage_failed` and
 * `kept_write_failed` went with physical deletion. Nothing here can produce
 * them now.)
 */
const FAILURES = [
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
    `${dryRun ? 'dry run' : 'recorded'}  physical deletion ${r.physicalDeletion}  examined ${r.examined}  ` +
      `purge deferred ${r.deferred} (${r.deferredFiles} recorded file path(s))  ` +
      `clocks started ${r.clocksStarted}  cleared ${r.clocksCleared}` +
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
 * SUPABASE_SERVICE_ROLE_KEY). No bucket: `sweep()` has no parameter for one.
 */
export function serviceDeps(out: (line: string) => void = console.log): SweepDeps {
  const admin = createAdminClient()
  return {
    sweep: (command) =>
      sweep(admin as unknown as SweepDb, {
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
 * Nothing touches the database until the arguments are valid.
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
