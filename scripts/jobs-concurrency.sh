#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# TWO WORKERS, AT THE SAME INSTANT
# ════════════════════════════════════════════════════════════════════════════
#
# db/verify-jobs.sql covers everything the queue does inside one transaction.
# It cannot cover the one thing the queue exists to get right: what a second
# worker does while the first is holding a row. `for update skip locked` only
# means anything across two connections, so this needs two.
#
# Vercel runs more than one instance. Two drains overlapping is not an edge
# case, it is Tuesday. The failure this guards against is the expensive kind:
# the same photograph processed twice, the same email sent twice.
#
#   bash scripts/jobs-concurrency.sh
#
# Wants psql on PATH and these, with the defaults used by the local rehearsal
# database (db/test-fixture.sql plus db/migrations/2026-09-29_jobs.sql):
#
#   PGHOST=/tmp PGPORT=5433 PGDATABASE=wtp PGUSER=postgres
#
# Unlike the .sql files this one COMMITS — it has to, or the second session
# would not see the first session's rows. It cleans up after itself, and it
# only ever touches rows whose kind is `test.concurrency`.
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5433}"
export PGDATABASE="${PGDATABASE:-wtp}"
export PGUSER="${PGUSER:-postgres}"

# Setup and inspection, as the owner.
Q() { psql -X -q -t -A -v ON_ERROR_STOP=1 -c "$1"; }

# A CLAIM, AS THE ROLE THAT ACTUALLY MAKES ONE.
#
# The drain runs as `service_role`, which has EXECUTE on the two queue
# functions and no privilege at all on the table — the functions are SECURITY
# DEFINER and that is the whole of the worker's reach. Running these as the
# table's owner instead would be testing a role that exists nowhere, and would
# have hidden the grant defect this file's sibling suite caught.
W() { psql -X -q -t -A -v ON_ERROR_STOP=1 -c "set role service_role" -c "$1"; }

pass=0
fail=0
ok() { # ok <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  ok    %-52s expected %-12s got %s\n' "$1" "$2" "$3"
    pass=$((pass + 1))
  else
    printf ' FAIL   %-52s expected %-12s got %s\n' "$1" "$2" "$3"
    fail=$((fail + 1))
  fi
}

# ── EVERY JOB FOR THE TEST SITE, not just this file's own kind ──────────────
#
# It used to delete `kind = 'test.concurrency'` only, and that was an isolation
# hole with teeth. The workers below call `claim_jobs(..., $TENANT)`, which
# takes the oldest claimable job for that SITE whatever its kind — so one
# leftover row from .mk/jobs.ts or from an interrupted run gets claimed instead
# of a row this file created, and the assertions that count who holds the
# `test.concurrency` rows report a collision that never happened.
#
# Demonstrated: a single foreign queued row for this tenant turns this suite
# into `13 passed, 1 failed — two workers can collide`, which is exactly the
# intermittent failure this fix is for.
#
# This site's queue belongs to this file for the duration, so it clears the lot.
cleanup() { Q "delete from jobs where tenant_id = '$TENANT'" >/dev/null 2>&1; }

# A guard rather than a hope: if the queue is not what this file put there,
# every count below is meaningless and it should say so here rather than fail
# confusingly ten assertions later.
expect_queue() { # expect_queue <n> <where>
  local n
  n=$(Q "select count(*) from jobs where tenant_id = '$TENANT'")
  ok "the queue holds only this test's $1 row(s) before $2" "$1" "${n:-?}"
}

TENANT=$(Q "select id from tenants order by created_at, id limit 1")
if [ -z "$TENANT" ]; then
  echo "No tenants — build db/test-fixture.sql first." >&2
  exit 1
fi

# Installed only now that $TENANT is known — `cleanup` names it.
trap cleanup EXIT
cleanup

# ── 1. Two jobs, two workers. Each must get one, and never the same one. ─────

Q "insert into jobs (tenant_id, kind) values ('$TENANT','test.concurrency'), ('$TENANT','test.concurrency')" >/dev/null
expect_queue 2 "two workers, two jobs"

A_OUT=$(mktemp); B_OUT=$(mktemp)

# Worker A claims one and then SITS ON THE TRANSACTION. Its row lock is held
# for the whole three seconds, which is the state worker B has to cope with.
(
  psql -X -q -t -A -v ON_ERROR_STOP=1 <<SQL > "$A_OUT" 2>&1
begin;
set role service_role;
select id from public.claim_jobs('A', 1, interval '5 minutes', '$TENANT');
select pg_sleep(3);
commit;
SQL
) &
A_PID=$!

sleep 1  # long enough that A is certainly inside its transaction

W "select id from public.claim_jobs('B', 1, interval '5 minutes', '$TENANT')" \
  > "$B_OUT" 2>&1
B_STATUS=$?
B_DONE=$(date +%s)

wait $A_PID

A_ID=$(grep -E '^[0-9a-f-]{36}$' "$A_OUT" | head -1)
B_ID=$(grep -E '^[0-9a-f-]{36}$' "$B_OUT" | head -1)

ok "worker B is not blocked by worker A"            "0"    "$B_STATUS"
ok "worker A claimed one"                           "yes"  "$([ -n "$A_ID" ] && echo yes || echo no)"
ok "worker B claimed one"                           "yes"  "$([ -n "$B_ID" ] && echo yes || echo no)"
ok "and it is NOT the same job"                     "diff" "$([ "$A_ID" != "$B_ID" ] && echo diff || echo SAME)"

ok "two jobs, two holders" "2" \
   "$(Q "select count(distinct locked_by) from jobs where kind='test.concurrency' and status='running'")"
ok "neither job was claimed twice" "1" \
   "$(Q "select coalesce(max(attempts),0) from jobs where kind='test.concurrency'")"

# ── 2. One job, two workers. The second gets nothing rather than waiting. ────
#
# This is the half `skip locked` is actually named for. Without it the second
# worker blocks until the first commits and then claims the SAME row, having
# waited for the privilege.

cleanup
Q "insert into jobs (tenant_id, kind) values ('$TENANT','test.concurrency')" >/dev/null
expect_queue 1 "one job, two workers"

C_OUT=$(mktemp); D_OUT=$(mktemp)

(
  psql -X -q -t -A -v ON_ERROR_STOP=1 <<SQL > "$C_OUT" 2>&1
begin;
set role service_role;
select id from public.claim_jobs('C', 1, interval '5 minutes', '$TENANT');
select pg_sleep(3);
commit;
SQL
) &
C_PID=$!

sleep 1
D_START=$(date +%s)
W "select count(*) from public.claim_jobs('D', 1, interval '5 minutes', '$TENANT')" \
  > "$D_OUT" 2>&1
D_ELAPSED=$(( $(date +%s) - D_START ))

wait $C_PID

D_COUNT=$(grep -E '^[0-9]+$' "$D_OUT" | head -1)

ok "the second worker gets nothing, not the same job" "0"   "${D_COUNT:-missing}"
ok "and it does not wait for the first"               "yes" \
   "$([ "$D_ELAPSED" -lt 2 ] && echo yes || echo "no (${D_ELAPSED}s)")"
ok "the one job still belongs to C"                   "C" \
   "$(Q "select locked_by from jobs where kind='test.concurrency'")"
ok "and was claimed exactly once"                     "1" \
   "$(Q "select attempts from jobs where kind='test.concurrency'")"

# ── 3. Six workers, three jobs, all at once. ────────────────────────────────
#
# The two blocks above are staged: one worker, then the other. This is the
# unstaged version, and it is the property that actually matters on Vercel —
# however many drains overlap, each job is done ONCE. Three claims from six
# workers, three different holders, and not one job on its second attempt.

cleanup
Q "insert into jobs (tenant_id, kind)
   select '$TENANT', 'test.concurrency' from generate_series(1, 3)" >/dev/null
expect_queue 3 "the six-way race"

RACE=$(mktemp -d)
for w in 1 2 3 4 5 6; do
  (
    W "select count(*) from public.claim_jobs('race-$w', 1, interval '5 minutes', '$TENANT')" \
      > "$RACE/$w" 2>&1
  ) &
done
wait

CLAIMED=$(Q "select count(*) from jobs where kind='test.concurrency' and status='running'")
HOLDERS=$(Q "select count(distinct locked_by) from jobs where kind='test.concurrency' and status='running'")
MAXATT=$(Q "select coalesce(max(attempts),0) from jobs where kind='test.concurrency'")
ERRORS=$(grep -lE 'ERROR|deadlock' "$RACE"/* 2>/dev/null | wc -l | tr -d ' ')

ok "six workers racing over three jobs: all three claimed" "3" "$CLAIMED"
ok "by three different workers"                            "3" "$HOLDERS"
ok "no job was claimed twice"                              "1" "$MAXATT"
ok "and nobody errored or deadlocked"                      "0" "$ERRORS"

rm -rf "$RACE"
rm -f "$A_OUT" "$B_OUT" "$C_OUT" "$D_OUT"

echo
echo "$((pass + fail)) assertions"
if [ "$fail" -eq 0 ]; then
  echo "$pass passed, 0 failed"
else
  echo "$pass passed, $fail failed — two workers can collide. Do not deploy the drain."
fi
exit $(( fail > 0 ? 1 : 0 ))
