#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# THE FIXTURE AND THE MIGRATIONS MUST AGREE — THE QUEUE, ANALYTICS, P1–P6
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
# ── P4 (deployed 2026-10-05 / 2026-10-06) ───────────────────────────────────
#
# Unit 1 (db/migrations/2026-10-05_photo_backfill.sql, Supabase 20261005192303)
# added five functions and replaced photo_usage_resolve_path; unit 2
# (db/migrations/2026-10-05_photo_assets_fk.sql, Supabase 20261006012958) added
# photos_asset_fk, site_images_asset_fk and their two partial indexes. The P4
# strip removes exactly those — the keys and indexes by name, the five
# functions by name (the resolver goes with P3's strip) — before anything else,
# because photo_assets cannot be dropped while the keys point at it. The
# rebuild runs unit 1 after Migration B and unit 2 last. All seventeen photo
# functions are compared with photo_assets' facts; the keys and indexes with
# photos' and site_images' (whole-table facts, so the creation shape and
# everything else on those tables is compared too).
#
# Unit 2 refuses to apply over incomplete data — its preflight is part of the
# deployed migration and is NOT weakened here. The fixture's seeds are not
# production's: three gallery photographs keep a NULL asset_id (a NULL passes a
# MATCH SIMPLE key, which is why the fixture can carry the keys at all). So in
# THIS scratch database only, after unit 1 and before unit 2, those rows are
# linked as the backfill would have linked them. That touches rows, not the
# catalogue, and the comparison is of the catalogue.
#
# Proved to bite (scripts/fixture-matches-migration.mjs --mutations) on: the
# fixture's photos_asset_fk made ON DELETE CASCADE, site_images_asset_tenant
# without its predicate, an authenticated EXECUTE grant on
# read_photo_backfill_inventory, the writer (register_legacy_photo_asset) made
# SECURITY INVOKER, the resolver
# back to P3's LIMIT 1, a clause missing from photo_backfill_foreign_claim, and
# the fixture missing unit 2's keys altogether (refused at the strip).
#
# ── P5 (deployed 2026-10-08) ────────────────────────────────────────────────
#
# Three migrations, in production's order: the album access revision
# (db/migrations/2026-10-08_album_access_revision.sql, Supabase 20261008154244),
# the render read (db/migrations/2026-10-07_photo_render_read.sql,
# 20261008154343) and its P5-R1 correction
# (db/migrations/2026-10-08_photo_render_record_fix.sql, 20261008180722). The P5
# strip runs FIRST (newest first): the reader dropped by name; the revision
# trigger, function and column dropped; and TRIGGER on albums given back to
# anon, authenticated and service_role — production's albums ACL before F1
# (Work's record, .ai-handoff/p5-f1-production-deployment-20261008.json) — so
# the revision migration's FIRST-RUN branch has to create all three and do the
# revoke itself. P5's projector goes with P3's seven (dropped by name in the P1
# strip): Migration B creates P3's, and the render read has to replace it. The
# replay then runs all three files after unit 2, so the reader is created
# with its deployed `v_a.id` body and the correction has to fix it.
#
# What is compared, beyond P1–P4: albums whole (now with the revision column,
# its default and nullability, the trigger's definition AND enablement, the
# TRIGGER grants that must be absent, the table's owner); and with
# photo_assets' functions the reader and the revision function (every
# function's definition — body, volatility, SECURITY, search_path — its owner
# and its EXECUTE grants). Facts added for every compared table: the table
# owner, a column's own ACL, and non-internal triggers.
#
# Proved to bite (scripts/fixture-matches-migration.mjs --mutations) on: the
# revision column nullable, and without its default; the trigger disabled, and
# UPDATE-only; the TRIGGER revoke missing; the revision function SECURITY
# DEFINER, executable by authenticated, and owned by another role; a column
# grant on access_revision; the reader back to its pre-R1 body, VOLATILE, and
# executable by authenticated; the projector's section-alt blank rule changed;
# and the fixture without the revision trigger (refused at the strip).
#
# ── P6 (deployed 2026-11-21) ────────────────────────────────────────────────
#
# One migration: the sweeper's lifecycle columns and grants
# (db/migrations/2026-11-03_photo_sweeper.sql, Supabase 20261121173616). It
# needs NO strip block of its own: everything it adds lives on photo_assets,
# and the P1 strip below drops photo_assets and photo_usages entirely — which
# takes the three columns, the CHECK, the partial index and the column-level
# grants with them. The replay then runs it LAST, after the P5-R1 correction,
# so it adds its columns with ALTER TABLE exactly as production did. That is
# why the fixture declares them as the final three columns: rank is compared,
# and declaring them beside the other lifecycle columns would be drift.
#
# What is compared, with no new facts needed: photo_assets' column list in
# order (the three nullable timestamptz columns, no defaults), its constraints
# (photo_assets_swept_after_unreferenced), its indexes
# (photo_assets_sweep_queue, partial), and each column's own ACL — which is
# where service_role's UPDATE on exactly four columns shows, deleted_at among
# them. photo_usages' table grants carry service_role's new SELECT.
#
# Bites without a mutation harness change: with the patched fixture, leaving
# this migration out of the replay reports the three columns, the CHECK, the
# index and five grants as drift. Checked 2026-11-21 against Postgres 16.
#
# ── Client gallery v2 (deployed 2026-11-22) ─────────────────────────────────
#
# One migration: three cover columns on albums
# (db/migrations/2026-11-22_album_cover_v2.sql, Supabase 20261122233150,
# album_cover_v2). Its strip runs FIRST (it is the newest): the key, its
# partial index, photos_id_album_tenant (the key's target, so after the key),
# the two CHECKs, then the three columns — each by name, so a fixture missing
# one is refused at the strip. The replay runs it LAST, after the sweeper, so
# its columns land after access_revision exactly as production's ALTER TABLE
# put them; the fixture declares them last for the same reason.
#
# What is compared, with no new facts needed: albums whole (the three nullable
# columns in rank order, no defaults, no column ACL; the two CHECKs; the key's
# full definition, SET NULL column list included; the partial index) and
# photos whole (photos_id_album_tenant and its index).
#
# A second migration, after it: albums_layout_style_check admits 'square'
# (db/migrations/2026-11-22_album_layout_square.sql, Supabase 20261122233837,
# album_layout_square). Its strip runs before the cover strip (it is newer)
# and puts the check back to production's three-value definition — the only
# state the migration will replace; it refuses any other. The replay runs it
# after the cover migration. albums' facts carry the check's full definition,
# so a fixture left at three values, or given a fifth, is drift.
#
# ── Client gallery v2, the gallery email send limit (deployed 2026-11-22) ────
#
# Two migrations, in production's order: the send limit
# (db/migrations/2026-11-22_gallery_email_send_limits.sql, Supabase
# 20261123001300, gallery_email_send_limits) creates the private table
# gallery_email_send_attempts and reserve_gallery_email_send(uuid, uuid,
# uuid); the recipient binding (db/migrations/2026-11-22_gallery_email_
# recipient_binding.sql, 20261123002952, gallery_email_recipient_binding)
# re-creates the function with its success result changed to
# 'reserved:<hex>' — and refuses unless it finds the first one's body or its
# own. Their strip runs FIRST of all (they are the newest): the function, then
# the table, each by name, so a fixture missing either is refused at the
# strip. The replay runs both LAST, after the square layout, so the first
# migration creates the table and the deployed body and the second has to
# correct it; reversed, the second's preflight refuses.
#
# What is compared: a fact set of its own for gallery_email_send_attempts —
# columns in rank order, the three constraints, both indexes, RLS, no policy,
# no trigger, the table grants (the owner's alone), the owner — and with it
# the function's full definition (body, SECURITY DEFINER, VOLATILE, both SET
# clauses), its owner and its ACL (the owner's and authenticated's EXECUTE,
# nothing else).
#
# Wants psql on PATH and a server it may create a scratch database on:
#
#   PGHOST=/tmp PGPORT=5433 PGUSER=postgres
#
# It runs only against a LOCAL server — a Unix-socket directory or a loopback
# address — and refuses any other PGHOST (and any PGHOSTADDR or PGSERVICE,
# which could redirect it). It creates its own uniquely named scratch database
# (`fixture_match_check_<pid>_<time>_<random>`), drops only a database THIS run
# created, and touches nothing else: `createdb` refuses a name that already
# exists, so a pre-existing database is never adopted and never deleted.
#
# Where psql is not available (a Windows checkout), the SAME proof runs from
# Node: `node scripts/fixture-matches-migration.mjs`. That runner reads this
# file — its strip blocks, its facts query, its migration order, its table and
# function lists — and executes them through node-postgres on a loopback
# scratch database. There is one definition of the proof, and it is this file.
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"

# libpq reads a comma in PGHOST as a list of hosts (`/tmp,remote.example`), so
# a comma is refused before the local-only shapes are matched.
case "$PGHOST" in
  *,*) echo "refusing PGHOST=$PGHOST: a comma names more than one host" >&2; exit 2 ;;
  /*|localhost|127.0.0.1|::1) ;;
  *) echo "refusing PGHOST=$PGHOST: only a Unix-socket directory or a loopback host" >&2; exit 2 ;;
esac
if [ -n "${PGHOSTADDR:-}" ] || [ -n "${PGSERVICE:-}" ]; then
  echo "refusing: PGHOSTADDR / PGSERVICE are set and could point somewhere other than PGHOST" >&2; exit 2
fi

DB="fixture_match_check_$$_$(date +%s)_${RANDOM}"
CREATED=0
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
# Deployed 2026-10-05 / 2026-10-06 (P4): unit 1, then unit 2.
BACKFILL="$ROOT/db/migrations/2026-10-05_photo_backfill.sql"
ASSET_FK="$ROOT/db/migrations/2026-10-05_photo_assets_fk.sql"
# Deployed 2026-10-08 (P5): the access revision, the render read, its R1 fix.
ACCESS_REV="$ROOT/db/migrations/2026-10-08_album_access_revision.sql"
RENDER_READ="$ROOT/db/migrations/2026-10-07_photo_render_read.sql"
RENDER_FIX="$ROOT/db/migrations/2026-10-08_photo_render_record_fix.sql"
# Deployed 2026-11-21 (P6): the sweeper's lifecycle columns and grants.
SWEEPER="$ROOT/db/migrations/2026-11-03_photo_sweeper.sql"
# Deployed 2026-11-22 (client gallery v2): three cover columns on albums.
COVER_V2="$ROOT/db/migrations/2026-11-22_album_cover_v2.sql"
# Deployed 2026-11-22, after it: layout_style admits 'square'.
SQUARE="$ROOT/db/migrations/2026-11-22_album_layout_square.sql"
# Deployed 2026-11-22, after both: the gallery email send limit, then its
# recipient binding.
GEL_LIMITS="$ROOT/db/migrations/2026-11-22_gallery_email_send_limits.sql"
GEL_BINDING="$ROOT/db/migrations/2026-11-22_gallery_email_recipient_binding.sql"

# Every table P1 created or altered. Compared whole — see the note at the top.
P1_TABLES="photo_assets photo_usages photos albums blog_posts catalog_items site_images"
# P2's, P3's and P4 unit 1's functions, compared with photo_assets' facts:
# definition (which carries SECURITY, search_path and body) and EXECUTE grants.
# Two of P2's — register_gallery_photo and register_album_cover — are as P3
# re-created them; photo_usage_resolve_path is as P4 unit 1 replaced it;
# sync_photo_usages is as P5's render read replaced it. P5 adds its two: the
# reader (as the R1 correction left it) and the album revision's trigger
# function.
P2_FNS="'upsert_photo_asset','register_gallery_photo','register_site_image','register_journal_image','register_album_cover','photo_usage_lock','photo_usage_parent_key','photo_usage_source','photo_usage_resolve_path','read_photo_usage_source','list_photo_usage_parents','sync_photo_usages','photo_backfill_key_base','photo_backfill_foreign_claim','read_photo_backfill_inventory','read_photo_backfill_claims','register_legacy_photo_asset','read_photo_render_assets','albums_access_revision'"

for f in "$FIXTURE" "$JOBS" "$ANALYTICS" "$PHOTOS" "$HOTFIX" "$INGEST" "$COVER_FK" "$USAGES" "$BACKFILL" "$ASSET_FK" "$ACCESS_REV" "$RENDER_READ" "$RENDER_FIX" "$SWEEPER" "$COVER_V2" "$SQUARE" "$GEL_LIMITS" "$GEL_BINDING"; do
  [ -r "$f" ] || { echo "cannot read $f" >&2; exit 1; }
done

# Drops the scratch database only if this run created it.
cleanup() { if [ "$CREATED" = 1 ]; then dropdb --if-exists "$DB" >/dev/null 2>&1; fi; }
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
  select 'acl  ' || p.proname || ' owner=' || pg_get_userbyid(p.proowner) || ' ' || coalesce(array_to_string(p.proacl, ','), '-')
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
         || a.dflt || a.nn || a.cacl as x
    from (
      select row_number() over (order by at.attnum) as rank,
             at.attname,
             format_type(at.atttypid, at.atttypmod) as kind,
             coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') as dflt,
             case when at.attnotnull then ' NOT NULL' else '' end as nn,
             coalesce(' ACL ' || at.attacl::text, '') as cacl
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
         || ' owner=' || pg_get_userbyid(c.relowner)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = '$table'
  union all
  -- Non-internal triggers: the definition (timing, events, function) and
  -- whether it is ENABLED — a disabled trigger keeps the same definition.
  select 'trg  ' || pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text
    from pg_trigger t
   where t.tgrelid = 'public.$table'::regclass and not t.tgisinternal
) z;
SQL
}

JOBS_FACTS=$(facts_sql jobs "'enqueue_jobs','claim_jobs','finish_job'")
PV_FACTS=$(facts_sql page_views "'record_page_view'")
GEL_FACTS=$(facts_sql gallery_email_send_attempts "'reserve_gallery_email_send'")
declare -A P1_FACTS P1_BEFORE P1_AFTER
for t in $P1_TABLES; do
  if [ "$t" = photo_assets ]; then P1_FACTS[$t]=$(facts_sql "$t" "$P2_FNS")
                              else P1_FACTS[$t]=$(facts_sql "$t" "''"); fi
done

createdb "$DB" >/dev/null || { echo "could not create $DB" >&2; exit 1; }
CREATED=1

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$FIXTURE" >/tmp/fmm-fixture.log 2>&1; then
  echo "FAIL  the fixture does not build:"; tail -5 /tmp/fmm-fixture.log; exit 1
fi

JOBS_BEFORE=$(psql -X -q -t -A -d "$DB" -c "$JOBS_FACTS")
PV_BEFORE=$(psql -X -q -t -A -d "$DB" -c "$PV_FACTS")
GEL_BEFORE=$(psql -X -q -t -A -d "$DB" -c "$GEL_FACTS")
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

# Client gallery v2's gallery email send limit, first of all: it is the
# newest. The function, then the table — by name, no CASCADE — so the send
# limit must create both and the recipient binding must correct the function.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/tmp/fmm-drop-gel.log 2>&1 <<'SQL'
drop function public.reserve_gallery_email_send(uuid, uuid, uuid);
drop table public.gallery_email_send_attempts;
SQL
then
  echo "FAIL  could not strip the fixture's gallery email send limit:"; tail -8 /tmp/fmm-drop-gel.log; exit 1
fi

# Client gallery v2's square layout, next: it is the newer of the two. The check
# goes back to production's three-value definition, the one state the
# migration replaces (any other it refuses), so the replay has to do the swap.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/tmp/fmm-drop-square.log 2>&1 <<'SQL'
alter table public.albums drop constraint albums_layout_style_check;
alter table public.albums add constraint albums_layout_style_check
  check (layout_style in ('masonry', 'grid', 'single_column'));
SQL
then
  echo "FAIL  could not strip the fixture's square layout:"; tail -8 /tmp/fmm-drop-square.log; exit 1
fi

# Client gallery v2's cover additions, by name, next. A missing one is a
# failure, not a skip.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/tmp/fmm-drop-coverv2.log 2>&1 <<'SQL'
alter table public.albums drop constraint albums_cover_secondary_photo_fk;
drop index public.albums_cover_secondary_photo;
alter table public.photos drop constraint photos_id_album_tenant;
alter table public.albums drop constraint albums_cover_zoom_range;
alter table public.albums drop constraint albums_cover_background_hex;
alter table public.albums
  drop column cover_secondary_photo_id,
  drop column cover_zoom,
  drop column cover_background;
SQL
then
  echo "FAIL  could not strip the fixture's client gallery v2 additions:"; tail -8 /tmp/fmm-drop-coverv2.log; exit 1
fi

# P5's additions, by name, next: newest first. A missing one is a failure, not
# a skip.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/tmp/fmm-drop-p5.log 2>&1 <<'SQL'
-- The render read's reader, so the render read has to create it and the R1
-- correction has to correct it. (Its projector goes with P3's, below.)
drop function public.read_photo_render_assets(uuid, jsonb);
-- The access revision's three objects, so its FIRST-RUN branch must create them.
drop trigger albums_access_revision on public.albums;
drop function public.albums_access_revision();
alter table public.albums drop column access_revision;
-- TRIGGER on albums as production had it before F1 (the three application
-- roles; not PUBLIC), so the migration's revoke has something to take back.
grant trigger on public.albums to anon, authenticated, service_role;
SQL
then
  echo "FAIL  could not strip the fixture's P5 additions:"; tail -8 /tmp/fmm-drop-p5.log; exit 1
fi

# P4's additions, by name, next: unit 2's keys point at photo_assets, which
# the P1 strip below drops. A missing one is a failure, not a skip.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/tmp/fmm-drop-p4.log 2>&1 <<'SQL'
-- Unit 2: the two keys and their two indexes, so unit 2 has to create them.
alter table public.photos      drop constraint photos_asset_fk;
alter table public.site_images drop constraint site_images_asset_fk;
drop index public.photos_asset_tenant;
drop index public.site_images_asset_tenant;
-- Unit 1: its five new functions, so unit 1 has to create them. The resolver
-- it replaced is dropped with P3's below, so Migration B creates P3's and
-- unit 1 has to replace it again.
drop function public.register_legacy_photo_asset(uuid, text, uuid, text, text, text, text, text, text, text, jsonb, integer, integer, bigint, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], text[], jsonb, boolean);
drop function public.read_photo_backfill_claims(uuid, text[]);
drop function public.read_photo_backfill_inventory(uuid);
drop function public.photo_backfill_foreign_claim(uuid, text, boolean);
drop function public.photo_backfill_key_base(text);
SQL
then
  echo "FAIL  could not strip the fixture's P4 additions:"; tail -8 /tmp/fmm-drop-p4.log; exit 1
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

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$BACKFILL" >/tmp/fmm-backfill.log 2>&1; then
  echo "FAIL  P4 unit 1 does not apply:"; tail -8 /tmp/fmm-backfill.log; exit 1
fi

# SCRATCH ONLY — see the P4 note at the top. The fixture's seeded photographs
# are linked as the backfill would have linked them, so unit 2's own,
# unweakened preflight has nothing to refuse. Rows only; nothing compared.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/tmp/fmm-link.log 2>&1 <<'SQL'
insert into public.photo_assets (tenant_id, key_base, display_path, derivatives, state)
select distinct tenant_id, regexp_replace(storage_path, '/[^/]+$', ''), storage_path, '{}'::jsonb, 'derived'
  from (select tenant_id, storage_path from public.photos where storage_path !~ '^/samples/'
        union all
        select tenant_id, storage_path from public.site_images) s;
update public.photos p set asset_id = a.id from public.photo_assets a
 where a.tenant_id = p.tenant_id and a.display_path = p.storage_path and p.storage_path !~ '^/samples/';
update public.site_images si set asset_id = a.id from public.photo_assets a
 where a.tenant_id = si.tenant_id and a.display_path = si.storage_path;
SQL
then
  echo "FAIL  could not link the fixture's seeded rows for unit 2:"; tail -8 /tmp/fmm-link.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ASSET_FK" >/tmp/fmm-assetfk.log 2>&1; then
  echo "FAIL  P4 unit 2 does not apply:"; tail -8 /tmp/fmm-assetfk.log; exit 1
fi

# P5, in production's order. The reader is created with its deployed (pre-R1)
# body, and the correction's own preflight accepts exactly that before fixing it.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ACCESS_REV" >/tmp/fmm-accessrev.log 2>&1; then
  echo "FAIL  the P5 access-revision migration does not apply:"; tail -8 /tmp/fmm-accessrev.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$RENDER_READ" >/tmp/fmm-renderread.log 2>&1; then
  echo "FAIL  the P5 render-read migration does not apply:"; tail -8 /tmp/fmm-renderread.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$RENDER_FIX" >/tmp/fmm-renderfix.log 2>&1; then
  echo "FAIL  the P5-R1 correction does not apply:"; tail -8 /tmp/fmm-renderfix.log; exit 1
fi

# P6, last, as production applied it: ALTER TABLE onto the photo_assets P1
# recreated, so the three columns land at the end of the table.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$SWEEPER" >/tmp/fmm-sweeper.log 2>&1; then
  echo "FAIL  the P6 sweeper migration does not apply:"; tail -8 /tmp/fmm-sweeper.log; exit 1
fi

# Client gallery v2, last, as production applied it: ALTER TABLE onto albums
# after F1's access_revision, so its three columns land at the end.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$COVER_V2" >/tmp/fmm-coverv2.log 2>&1; then
  echo "FAIL  the client gallery v2 cover migration does not apply:"; tail -8 /tmp/fmm-coverv2.log; exit 1
fi

# Client gallery v2's square layout, after the cover migration, as production
# applied it: the three-value check replaced under the same name.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$SQUARE" >/tmp/fmm-square.log 2>&1; then
  echo "FAIL  the client gallery v2 square-layout migration does not apply:"; tail -8 /tmp/fmm-square.log; exit 1
fi

# The gallery email send limit, last, as production applied it: the table and
# the deployed function body; then the recipient binding, whose preflight
# accepts exactly that body before it changes the success result.
if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$GEL_LIMITS" >/tmp/fmm-gel-limits.log 2>&1; then
  echo "FAIL  the gallery email send-limit migration does not apply:"; tail -8 /tmp/fmm-gel-limits.log; exit 1
fi

if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$GEL_BINDING" >/tmp/fmm-gel-binding.log 2>&1; then
  echo "FAIL  the gallery email recipient-binding migration does not apply:"; tail -8 /tmp/fmm-gel-binding.log; exit 1
fi

JOBS_AFTER=$(psql -X -q -t -A -d "$DB" -c "$JOBS_FACTS")
PV_AFTER=$(psql -X -q -t -A -d "$DB" -c "$PV_FACTS")
GEL_AFTER=$(psql -X -q -t -A -d "$DB" -c "$GEL_FACTS")
for t in $P1_TABLES; do P1_AFTER[$t]=$(psql -X -q -t -A -d "$DB" -c "${P1_FACTS[$t]}"); done

fail=0

for pair in "jobs:2026-09-29_jobs.sql + 2026-09-30_enqueue_jobs_tenant_guard.sql" "page_views:2026-09-29_analytics.sql" "gallery_email_send_attempts:2026-11-22_gallery_email_send_limits.sql + 2026-11-22_gallery_email_recipient_binding.sql"; do
  table="${pair%%:*}"; file="${pair##*:}"
  case "$table" in
    jobs)       before="$JOBS_BEFORE"; after="$JOBS_AFTER" ;;
    page_views) before="$PV_BEFORE";   after="$PV_AFTER" ;;
    *)          before="$GEL_BEFORE";  after="$GEL_AFTER" ;;
  esac

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
  [ "$table" = photo_assets ] && file="2026-09-29_photo_assets.sql + 2026-09-30_photo_ingest.sql + 2026-09-30_photo_usages_sync.sql + 2026-10-05_photo_backfill.sql + the three P5 files (19 functions) + 2026-11-03_photo_sweeper.sql"
  [ "$table" = photo_usages ] && file="2026-09-29_photo_assets.sql + 2026-09-30_photo_usages_sync.sql + 2026-11-03_photo_sweeper.sql"
  [ "$table" = albums ] && file="2026-09-29_photo_assets.sql + 2026-09-30_album_cover_tenant_fk.sql + 2026-10-08_album_access_revision.sql + 2026-11-22_album_cover_v2.sql + 2026-11-22_album_layout_square.sql"
  [ "$table" = photos ] && file="2026-09-29_photo_assets.sql + 2026-10-05_photo_assets_fk.sql + 2026-11-22_album_cover_v2.sql"
  [ "$table" = site_images ] && file="2026-09-29_photo_assets.sql + 2026-10-05_photo_assets_fk.sql"

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
