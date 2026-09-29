#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# THE FIXTURE AND THE MIGRATION MUST AGREE ABOUT THE QUEUE
# ════════════════════════════════════════════════════════════════════════════
#
# `db/test-fixture.sql` now contains `jobs` and its three functions, because
# production does. The text was copied from `db/migrations/2026-09-29_jobs.sql`,
# and two copies of anything is a thing that drifts — which is the exact failure
# S1 cost three incidents to learn: a fixture that disagrees with production
# makes a local rehearsal prove the opposite of the truth.
#
# So this asks the database rather than trusting the copy. It builds the fixture
# and records every fact about `jobs` that could differ — column types and
# defaults, constraints, indexes, the policy, RLS, table grants, and all three
# function definitions with their EXECUTE grants. Then it DROPS the whole thing
# and lets the migration build it instead, and records the same facts again.
#
# The drop matters. An earlier version applied the migration on top of the
# fixture and compared before with after, and it was useless: `create table if
# not exists` does not touch a table that already exists, so a wrong column
# default in the fixture survived the migration untouched and the two snapshots
# agreed. Proved by changing `max_attempts default 5` to `7` and watching it
# pass. Only a version that makes the migration do the creating can see that.
#
#   bash scripts/fixture-matches-migration.sh
#
# Wants psql on PATH and a server it may create a scratch database on:
#
#   PGHOST=/tmp PGPORT=5433 PGUSER=postgres
#
# It creates and drops its own database (`fixture_match_check`) and touches
# nothing else.
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"

DB=fixture_match_check
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$ROOT/db/test-fixture.sql"
MIGRATION="$ROOT/db/migrations/2026-09-29_jobs.sql"

for f in "$FIXTURE" "$MIGRATION"; do
  [ -r "$f" ] || { echo "cannot read $f" >&2; exit 1; }
done

cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1; }
trap cleanup EXIT

# Every fact about `jobs` that a drifted copy could get wrong.
FACTS=$(cat <<'SQL'
select string_agg(x, E'\n' order by x) from (
  select 'fn   ' || pg_get_functiondef(p.oid) as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('enqueue_jobs','claim_jobs','finish_job')
  union all
  select 'acl  ' || p.proname || ' ' || coalesce(array_to_string(p.proacl, ','), '-')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('enqueue_jobs','claim_jobs','finish_job')
  union all
  select 'col  ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
         || case when a.attnotnull then ' NOT NULL' else '' end
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.jobs'::regclass and a.attnum > 0 and not a.attisdropped
  union all
  select 'con  ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
    from pg_constraint c where c.conrelid = 'public.jobs'::regclass
  union all
  select 'idx  ' || indexdef from pg_indexes
   where schemaname = 'public' and tablename = 'jobs'
  union all
  select 'pol  ' || policyname || ' | ' || cmd || ' | ' || coalesce(qual, '-')
         || ' | ' || coalesce(with_check, '-')
    from pg_policies where schemaname = 'public' and tablename = 'jobs'
  union all
  select 'gr   ' || grantee || ' ' || privilege_type
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'jobs'
  union all
  select 'rls  ' || case when c.relrowsecurity then 'enabled' else 'DISABLED' end
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'jobs'
) z;
SQL
)

cleanup
createdb "$DB" >/dev/null || { echo "could not create $DB" >&2; exit 1; }

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$FIXTURE" >/tmp/fmm-fixture.log 2>&1; then
  echo "FAIL  the fixture does not build:"; tail -5 /tmp/fmm-fixture.log; exit 1
fi

BEFORE=$(psql -X -q -t -A -d "$DB" -c "$FACTS")

# Out of the way entirely, so the migration has to create it. CASCADE takes the
# three functions with it — they return `public.jobs`, so they cannot outlive it.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" \
     -c 'drop table public.jobs cascade' >/tmp/fmm-drop.log 2>&1; then
  echo "FAIL  could not drop the fixture's jobs table:"; tail -5 /tmp/fmm-drop.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION" >/tmp/fmm-migration.log 2>&1; then
  echo "FAIL  the migration does not build jobs from nothing:"; tail -5 /tmp/fmm-migration.log; exit 1
fi

AFTER=$(psql -X -q -t -A -d "$DB" -c "$FACTS")

if [ -z "$BEFORE" ]; then
  echo "FAIL  the fixture built no jobs table at all."
  exit 1
fi

if [ "$BEFORE" = "$AFTER" ]; then
  echo "ok    the fixture reproduces db/migrations/2026-09-29_jobs.sql exactly"
  echo "      ($(printf '%s' "$BEFORE" | wc -l | tr -d ' ') facts compared: columns, constraints,"
  echo "       indexes, policy, RLS, table grants, three function bodies and their EXECUTE grants)"
  exit 0
fi

echo "FAIL  the fixture has drifted from the migration. These facts differ"
echo "      between the fixture's jobs and the migration's — the fixture is"
echo "      the one that is wrong (< fixture, > migration):"
echo
diff <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER")
exit 1
