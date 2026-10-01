#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# THE FIXTURE AND THE MIGRATIONS MUST AGREE ABOUT THE QUEUE AND ABOUT ANALYTICS
# ════════════════════════════════════════════════════════════════════════════
#
# `db/test-fixture.sql` contains `jobs` with its three functions and `page_views`
# with its six S4 columns, its seven CHECKs, its two new indexes, its replaced
# policy, its narrowed grants and `record_page_view` — because production does.
# The text was copied from `db/migrations/2026-09-29_jobs.sql` and
# `db/migrations/2026-09-29_analytics.sql`, and two copies of anything is a thing
# that drifts, which is the exact failure S1 cost three incidents to learn: a
# fixture that disagrees with production makes a local rehearsal prove the
# opposite of the truth.
#
# So this asks the database rather than trusting the copy. It builds the fixture
# and records every fact about both tables that could differ — column types and
# defaults, constraints, indexes, policies, RLS, table grants, and every function
# definition with its EXECUTE grants. Then it DESTROYS both and lets the
# migrations build them instead, and records the same facts again.
#
#   bash scripts/fixture-matches-migration.sh
#
# ── Why it drops rather than re-applies ─────────────────────────────────────
#
# The drop is the whole thing. An earlier version applied the migration on top of
# the fixture and compared before with after, and it was useless: `create table
# if not exists` does not touch a table that already exists, `add column if not
# exists` does not touch a column, and `if not exists (select 1 from
# pg_constraint …)` does not touch a constraint. So a wrong column default in the
# fixture survived the migration untouched and the two snapshots agreed. Proved
# by changing `max_attempts default 5` to `7` and watching it pass. Only a
# version that makes the migration do the CREATING can see that.
#
# ── Why page_views is emptied rather than dropped ───────────────────────────
#
# `jobs` is dropped outright: the fixture seeds no jobs, and nothing points at
# it. `page_views` cannot be — S4 is an ADDITIVE migration over a table that
# already existed before it, so dropping the table would leave the migration with
# nothing to alter and it would fail on the first `alter table`. What is dropped
# instead is everything S4 ADDED: the six columns (which takes their constraints
# and indexes with them), the policy, and the function. The rows go too, because
# `tenant_id` comes back NOT NULL and the fixture's two seeded views would have no
# value for it — and because the header's own warning applies, that a comparison
# which cannot fail is not a comparison.
#
# Proved to bite, the same way the jobs half was: changing the fixture's
# `page_views_session_shape` to accept upper-case hex makes this report a
# difference, and reverting it makes it agree again.
#
# ── P1: the photo tables, and the five tables P1 touched ────────────────────
#
# Added 2026-09-30, after db/migrations/2026-09-29_photo_assets.sql was deployed
# (Supabase 20260930123113) and reconciled into the fixture. P1 is both kinds of
# change at once, so it is checked both ways:
#
#   · `photo_assets` and `photo_usages` are NEW — dropped outright, like `jobs`.
#   · `photos`, `albums`, `blog_posts`, `catalog_items` and `site_images` already
#     existed. What P1 ADDED to them is stripped — `asset_id` on two, the
#     `unique (id, tenant_id)` target on four — and the migration puts it back.
#     Their WHOLE fact set is compared, not just the added parts, so the check
#     also proves the migration changed nothing else on a parent table.
#
# P1 creates no function, so its function list is empty. The generated columns
# (`orientation`, `aspect_ratio`) are compared through their generation
# expression, which `pg_get_expr` reports as the column's default.
#
# Proved to bite before it was trusted: a fixture slot index missing `position`,
# a guessing tenant default on `photo_assets`, an INSERT grant to authenticated,
# a wrong `aspect_ratio` rounding, and a missing `albums_id_tenant` are each
# reported as drift and each reverts to agreement.
#
# ── The S3 hotfix and P2 (deployed 2026-09-30) ──────────────────────────────
#
# `jobs` is now rebuilt from the jobs migration FOLLOWED BY the enqueue_jobs
# tenant-guard hotfix, because that pair is what production runs. enqueue_jobs
# is dropped by name first — `drop table jobs cascade` never removed it (it
# returns an integer, not a jobs row), so an earlier version compared a
# fixture copy against itself for that one function.
#
# P2 changed functions only. Its five are dropped by name with the P1 strip
# and rebuilt from db/migrations/2026-09-30_photo_ingest.sql; their
# definitions and EXECUTE grants are compared as part of photo_assets' facts.
# Proved to bite on: the fixture's enqueue_jobs guard reverted to the
# NULL-blind form, a changed check in upsert_photo_asset, an extra EXECUTE
# grant on the helper, a wrapper made SECURITY INVOKER, and a missing function.
#
# ── P3 (deployed 2026-10-01) ────────────────────────────────────────────────
#
# Production's photo tables are now P1 + P2 + P3's Migration A + Migration B,
# applied in that order, and so is the rebuild here. Migration A makes
# albums_cover_photo_fk tenant-aware; it depends on photos_id_tenant, so the P1
# strip first puts the cover key back to its pre-P3 single-column form (as P1
# found it) before removing that target — Migration A then has to recreate it.
# Migration B restates three photo_usages CHECKs, adds the share-slot CHECK and
# the page_share slot index (all compared with photo_usages' facts), creates
# seven functions, and re-creates register_gallery_photo and
# register_album_cover with the album lock. All seven are dropped by name in
# the strip, and every one of the twelve photo functions is compared —
# definition (security, search_path, body) and EXECUTE grants — with
# photo_assets' facts. The cover key is compared with albums' facts.
#
# Proved to bite on: the fixture's cover key reverted to single-column, the
# share-slot CHECK weakened, the share slot index missing a column, an
# authenticated EXECUTE grant on sync_photo_usages, register_gallery_photo
# without its lock, the resolver without its same-site filter, and a missing
# P3 function.
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
JOBS="$ROOT/db/migrations/2026-09-29_jobs.sql"
ANALYTICS="$ROOT/db/migrations/2026-09-29_analytics.sql"
PHOTOS="$ROOT/db/migrations/2026-09-29_photo_assets.sql"
# Deployed 2026-09-30: production's jobs is the jobs migration PLUS this hotfix
# (enqueue_jobs' NULL-safe tenant guard), and production's photo tables carry
# P2's five functions.
HOTFIX="$ROOT/db/migrations/2026-09-30_enqueue_jobs_tenant_guard.sql"
INGEST="$ROOT/db/migrations/2026-09-30_photo_ingest.sql"
# Deployed 2026-10-01 (P3): Migration A, then Migration B.
COVER_FK="$ROOT/db/migrations/2026-09-30_album_cover_tenant_fk.sql"
USAGES="$ROOT/db/migrations/2026-09-30_photo_usages_sync.sql"

# Every table P1 created or altered. Compared whole — see the note at the top.
P1_TABLES="photo_assets photo_usages photos albums blog_posts catalog_items site_images"
# P2's and P3's functions, compared with photo_assets' facts: definition (which
# carries SECURITY, search_path and body) and EXECUTE grants. Two of P2's —
# register_gallery_photo and register_album_cover — are as P3 re-created them.
P2_FNS="'upsert_photo_asset','register_gallery_photo','register_site_image','register_journal_image','register_album_cover','photo_usage_lock','photo_usage_parent_key','photo_usage_source','photo_usage_resolve_path','read_photo_usage_source','list_photo_usage_parents','sync_photo_usages'"

for f in "$FIXTURE" "$JOBS" "$ANALYTICS" "$PHOTOS" "$HOTFIX" "$INGEST" "$COVER_FK" "$USAGES"; do
  [ -r "$f" ] || { echo "cannot read $f" >&2; exit 1; }
done

cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1; }
trap cleanup EXIT

# Every fact about either table that a drifted copy could get wrong. `$1` is the
# table; the function names are matched by list so a missing one is a difference
# rather than an empty result that quietly matches.
facts_sql() {
  local table="$1" fns="$2"
  cat <<SQL
select string_agg(x, E'\n' order by x) from (
  select 'fn   ' || pg_get_functiondef(p.oid) as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ($fns)
  union all
  select 'acl  ' || p.proname || ' ' || coalesce(array_to_string(p.proacl, ','), '-')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ($fns)
  union all
  -- Position is compared as a RANK among the live columns, not as the raw
  -- "attnum". Two reasons, and the first one bit:
  --
  --   · this script drops six columns from page_views and lets the migration
  --     add them back, which leaves gaps — the rebuilt ones came back as
  --     attnum 12-17 where the fixture had 6-11. Identical shape, identical
  --     order, different numbers, reported as drift. The script's own doing.
  --   · production reached those columns by "add column" (attnum 6-11) and the
  --     fixture declares them inline (1-11), so the raw numbers were never
  --     comparable between the two databases either.
  --
  -- The rank still compares ORDER, which is what matters and what a careless
  -- edit to the fixture would get wrong. Dropping the position from the
  -- comparison altogether would have been the easy fix and the wrong one.
  select 'col  ' || lpad(a.rank::text, 2, '0') || ' ' || a.attname || ' ' || a.kind
         || a.dflt || a.nn as x
    from (
      select row_number() over (order by at.attnum) as rank,
             at.attname,
             format_type(at.atttypid, at.atttypmod) as kind,
             coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') as dflt,
             case when at.attnotnull then ' NOT NULL' else '' end as nn
        from pg_attribute at
        left join pg_attrdef d on d.adrelid = at.attrelid and d.adnum = at.attnum
       where at.attrelid = 'public.$table'::regclass
         and at.attnum > 0 and not at.attisdropped
    ) a
  union all
  select 'con  ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
    from pg_constraint c where c.conrelid = 'public.$table'::regclass
  union all
  select 'idx  ' || indexdef from pg_indexes
   where schemaname = 'public' and tablename = '$table'
  union all
  select 'pol  ' || policyname || ' | ' || cmd || ' | ' || coalesce(qual, '-')
         || ' | ' || coalesce(with_check, '-')
    from pg_policies where schemaname = 'public' and tablename = '$table'
  union all
  select 'gr   ' || grantee || ' ' || privilege_type
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = '$table'
  union all
  select 'rls  ' || case when c.relrowsecurity then 'enabled' else 'DISABLED' end
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = '$table'
) z;
SQL
}

JOBS_FACTS=$(facts_sql jobs "'enqueue_jobs','claim_jobs','finish_job'")
PV_FACTS=$(facts_sql page_views "'record_page_view'")
declare -A P1_FACTS P1_BEFORE P1_AFTER
for t in $P1_TABLES; do
  if [ "$t" = photo_assets ]; then P1_FACTS[$t]=$(facts_sql "$t" "$P2_FNS")
                              else P1_FACTS[$t]=$(facts_sql "$t" "''"); fi
done

cleanup
createdb "$DB" >/dev/null || { echo "could not create $DB" >&2; exit 1; }

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$FIXTURE" >/tmp/fmm-fixture.log 2>&1; then
  echo "FAIL  the fixture does not build:"; tail -5 /tmp/fmm-fixture.log; exit 1
fi

JOBS_BEFORE=$(psql -X -q -t -A -d "$DB" -c "$JOBS_FACTS")
PV_BEFORE=$(psql -X -q -t -A -d "$DB" -c "$PV_FACTS")
for t in $P1_TABLES; do P1_BEFORE[$t]=$(psql -X -q -t -A -d "$DB" -c "${P1_FACTS[$t]}"); done

# ── Out of the way, so the migrations have to do the creating ───────────────
#
# `jobs` goes entirely. CASCADE takes its three functions with it — they return
# `public.jobs`, so they cannot outlive it.
#
# `page_views` keeps its pre-S4 shape and loses everything S4 added. Dropping the
# six columns takes their CHECKs and indexes with them; the policy and the
# function are named explicitly because nothing else removes them. The rows go
# first, because `tenant_id` comes back NOT NULL.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/tmp/fmm-drop.log 2>&1 <<'SQL'
drop table public.jobs cascade;
-- enqueue_jobs returns an integer, so the CASCADE above does not take it; it
-- is dropped by name so the jobs migration and the hotfix must recreate it.
drop function public.enqueue_jobs(uuid, text, jsonb);

delete from public.page_views;
-- The policy first: it names `tenant_id`, so the column cannot be dropped while
-- it exists. Postgres says so plainly and suggests CASCADE, which would work and
-- would be the wrong tool — CASCADE removes whatever it finds, and the point of
-- this script is that the list of things S4 added is written out where somebody
-- can check it.
drop policy "Tenant members manage" on public.page_views;
alter table public.page_views
  drop column tenant_id,
  drop column path,
  drop column page_key,
  drop column referrer_host,
  drop column session_hash,
  drop column device;
alter table public.page_views drop constraint page_views_visitor_is_a_hash;
drop function public.record_page_view(uuid, text, text, text, text, text, uuid, uuid, text);
-- And the grants back to what they were before S4 narrowed them, so the
-- migration's revoke-then-grant has something to change.
grant delete, insert, references, select, trigger, truncate, update
  on public.page_views to anon, authenticated, service_role;
SQL
then
  echo "FAIL  could not strip the fixture's S4 additions:"; tail -8 /tmp/fmm-drop.log; exit 1
fi

# P1's additions, written out one by one for the same reason as S4's. The two
# new tables first: photo_usages' foreign keys depend on the four parent unique
# constraints, which cannot be dropped while those keys exist.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/tmp/fmm-drop-p1.log 2>&1 <<'SQL'
-- P3's seven functions, by name, so Migration B has to create them.
drop function public.sync_photo_usages(uuid, text, text, text, jsonb);
drop function public.list_photo_usage_parents(uuid);
drop function public.read_photo_usage_source(uuid, text, text);
drop function public.photo_usage_resolve_path(uuid, text);
drop function public.photo_usage_source(uuid, text, text);
drop function public.photo_usage_parent_key(uuid, text, text);
drop function public.photo_usage_lock(uuid, text, text);
-- P2's five functions, by name (a missing one is a failure, not a skip), so
-- the P2 migration has to create them (and Migration B to re-lock two).
drop function public.register_gallery_photo(uuid, uuid, text, text, text, jsonb, integer, integer, bigint, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb, double precision, double precision);
drop function public.register_site_image(uuid, text, text, text, jsonb, integer, integer, bigint, text, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb);
drop function public.register_journal_image(uuid, text, text, text, jsonb, integer, integer, bigint, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb);
drop function public.register_album_cover(uuid, uuid, text, text, jsonb, integer, integer, bigint, text, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb);
drop function public.upsert_photo_asset(uuid, text, text, text, jsonb, integer, integer, bigint, text, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb, double precision, double precision, uuid);
drop table public.photo_usages;
drop table public.photo_assets;
-- The cover key as P1 found it (pre-P3, single column), so Migration A has to
-- make it tenant-aware — and so photos_id_tenant, which it would otherwise
-- depend on, can be removed below.
alter table public.albums drop constraint albums_cover_photo_fk;
alter table public.albums add constraint albums_cover_photo_fk
  foreign key (cover_photo_id) references public.photos (id) on delete set null;
alter table public.photos        drop column asset_id;
alter table public.site_images   drop column asset_id;
alter table public.photos        drop constraint photos_id_tenant;
alter table public.albums        drop constraint albums_id_tenant;
alter table public.blog_posts    drop constraint blog_posts_id_tenant;
alter table public.catalog_items drop constraint catalog_items_id_tenant;
SQL
then
  echo "FAIL  could not strip the fixture's P1 additions:"; tail -8 /tmp/fmm-drop-p1.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$JOBS" >/tmp/fmm-jobs.log 2>&1; then
  echo "FAIL  the jobs migration does not build jobs from nothing:"; tail -5 /tmp/fmm-jobs.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HOTFIX" >/tmp/fmm-hotfix.log 2>&1; then
  echo "FAIL  the enqueue_jobs hotfix does not apply:"; tail -5 /tmp/fmm-hotfix.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ANALYTICS" >/tmp/fmm-analytics.log 2>&1; then
  echo "FAIL  the analytics migration does not rebuild page_views:"; tail -8 /tmp/fmm-analytics.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$PHOTOS" >/tmp/fmm-photos.log 2>&1; then
  echo "FAIL  the P1 migration does not rebuild the photo tables:"; tail -8 /tmp/fmm-photos.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$INGEST" >/tmp/fmm-ingest.log 2>&1; then
  echo "FAIL  the P2 migration does not rebuild its functions:"; tail -8 /tmp/fmm-ingest.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$COVER_FK" >/tmp/fmm-coverfk.log 2>&1; then
  echo "FAIL  P3 Migration A does not apply:"; tail -8 /tmp/fmm-coverfk.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$USAGES" >/tmp/fmm-usages.log 2>&1; then
  echo "FAIL  P3 Migration B does not apply:"; tail -8 /tmp/fmm-usages.log; exit 1
fi

JOBS_AFTER=$(psql -X -q -t -A -d "$DB" -c "$JOBS_FACTS")
PV_AFTER=$(psql -X -q -t -A -d "$DB" -c "$PV_FACTS")
for t in $P1_TABLES; do P1_AFTER[$t]=$(psql -X -q -t -A -d "$DB" -c "${P1_FACTS[$t]}"); done

fail=0

for pair in "jobs:2026-09-29_jobs.sql + 2026-09-30_enqueue_jobs_tenant_guard.sql" "page_views:2026-09-29_analytics.sql"; do
  table="${pair%%:*}"; file="${pair##*:}"
  if [ "$table" = jobs ]; then before="$JOBS_BEFORE"; after="$JOBS_AFTER"
                          else before="$PV_BEFORE";   after="$PV_AFTER"; fi

  if [ -z "$before" ]; then
    echo "FAIL  the fixture built no $table at all."
    fail=1
    continue
  fi

  if [ "$before" = "$after" ]; then
    echo "ok    the fixture's $table reproduces db/migrations/$file exactly"
    echo "      ($(printf '%s' "$before" | grep -c '' | tr -d ' ') facts compared: columns in order,"
    echo "       constraints, indexes, policies, RLS, table grants, function bodies"
    echo "       and their EXECUTE grants)"
  else
    echo "FAIL  the fixture's $table has drifted from db/migrations/$file."
    echo "      These facts differ — the fixture is the one that is wrong"
    echo "      (< fixture, > migration):"
    echo
    diff <(printf '%s\n' "$before") <(printf '%s\n' "$after")
    echo
    fail=1
  fi
done

for table in $P1_TABLES; do
  before="${P1_BEFORE[$table]}"; after="${P1_AFTER[$table]}"
  file=2026-09-29_photo_assets.sql
  [ "$table" = photo_assets ] && file="2026-09-29_photo_assets.sql + 2026-09-30_photo_ingest.sql + 2026-09-30_photo_usages_sync.sql (12 functions)"
  [ "$table" = photo_usages ] && file="2026-09-29_photo_assets.sql + 2026-09-30_photo_usages_sync.sql"
  [ "$table" = albums ] && file="2026-09-29_photo_assets.sql + 2026-09-30_album_cover_tenant_fk.sql"

  if [ -z "$before" ]; then
    echo "FAIL  the fixture built no $table at all."
    fail=1
    continue
  fi

  if [ "$before" = "$after" ]; then
    echo "ok    the fixture's $table reproduces db/migrations/$file exactly"
    echo "      ($(printf '%s' "$before" | grep -c '' | tr -d ' ') facts compared)"
  else
    echo "FAIL  the fixture's $table has drifted from db/migrations/$file."
    echo "      These facts differ — the fixture is the one that is wrong"
    echo "      (< fixture, > migration):"
    echo
    diff <(printf '%s\n' "$before") <(printf '%s\n' "$after")
    echo
    fail=1
  fi
done

exit $fail
