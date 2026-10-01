#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# P3's PREREQUISITE, END TO END: the tenant-aware album cover key
# ════════════════════════════════════════════════════════════════════════════
#
# db/verify-album-cover-fk.sql proves what the migrated database does. This
# proves the migration itself, on a scratch database built from the fixture:
#
#   1. the PREFLIGHT: with a cover already pointing at another site, the
#      migration refuses and changes nothing;
#   2. it applies, and applies again (safe to run twice);
#   3. the verify suite passes against it;
#   4. the ROLLBACK in the migration's footer restores the original key
#      exactly — the catalogue definition, character for character;
#   5. the MUTATION: against that original single-column key the verify suite
#      FAILS, on the cross-site checks. A suite that passed there would be
#      green for the wrong reason.
#
#   bash scripts/album-cover-fk.sh
#
# Uses PGHOST / PGPORT / PGUSER like the other scripts; creates and drops its
# own database, `wtp_cover_fk`.

set -uo pipefail
cd "$(dirname "$0")/.."

DB=wtp_cover_fk
MIG=db/migrations/2026-09-30_album_cover_tenant_fk.sql
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
pass=0
fail=0
ok()   { pass=$((pass + 1)); echo "  ok    $1"; }
bad()  { fail=$((fail + 1)); echo "  FAIL  $1"; [ -n "${2:-}" ] && echo "        $2"; }
is()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "got [$2], wanted [$3]"; fi; }
q()    { "${PSQL[@]}" -At -c "$1"; }
def()  { q "select pg_get_constraintdef(oid) from pg_constraint where conname = 'albums_cover_photo_fk'"; }

dropdb --if-exists "$DB" >/dev/null 2>&1
createdb "$DB" || { echo "could not create $DB"; exit 2; }
"${PSQL[@]}" -f db/test-fixture.sql >/dev/null 2>&1 || { echo "the fixture did not build"; exit 2; }

NEW='FOREIGN KEY (cover_photo_id, tenant_id) REFERENCES photos(id, tenant_id) ON DELETE SET NULL (cover_photo_id)'

# Since Migration A was DEPLOYED (Supabase 20261001005946, 2026-10-01) the
# fixture carries production's tenant-aware key. To rehearse the migration
# from where it actually started, this scratch database is put back to the
# pre-P3 key first — exactly what scripts/fixture-matches-migration.sh does.
is 'the fixture carries production'"'"'s tenant-aware key' "$(def)" "$NEW"
q "alter table albums drop constraint albums_cover_photo_fk;
   alter table albums add constraint albums_cover_photo_fk
     foreign key (cover_photo_id) references photos (id) on delete set null;" >/dev/null

ORIGINAL="$(def)"
is 'rehearsing from the original single-column key' "$ORIGINAL" \
   'FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL'

# ── 1. The preflight refuses a database that already crosses sites ──────────
q "insert into photos (id, tenant_id, album_id, storage_path, sort_order) values
     ('cccccccc-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000002',
      'bbbbbbbb-0000-0000-0000-000000000003', 't/two/photos/x/1/2400.webp', 0);
   update albums set cover_photo_id = 'cccccccc-0000-0000-0000-0000000000b1'
    where id = 'bbbbbbbb-0000-0000-0000-000000000001';" >/dev/null
out="$("${PSQL[@]}" -f "$MIG" 2>&1)"; code=$?
is 'with a cross-site cover present, the migration fails' "$code" '3'
case "$out" in
  *'P3 prerequisite refused: 1 album(s) name a cover photograph on another site'*) ok '…saying why, and how many' ;;
  *) bad '…saying why, and how many' "$out" ;;
esac
is '…and changed NOTHING: the original key is still there' "$(def)" "$ORIGINAL"

# ── 2. Fixed, it applies — twice ─────────────────────────────────────────────
# (The verify suite brings its own site-B photograph; take this one away.)
q "update albums set cover_photo_id = 'cccccccc-0000-0000-0000-000000000001'
    where id = 'bbbbbbbb-0000-0000-0000-000000000001';
   delete from photos where id = 'cccccccc-0000-0000-0000-0000000000b1'" >/dev/null
"${PSQL[@]}" -f "$MIG" >/dev/null 2>&1; is 'the migration applies' "$?" '0'
"${PSQL[@]}" -f "$MIG" >/dev/null 2>&1; is '…and applies a second time' "$?" '0'
is 'the key is the tenant-aware one' "$(def)" "$NEW"
is 'exactly one such constraint' "$(q "select count(*) from pg_constraint where conname = 'albums_cover_photo_fk'")" '1'
is 'the album kept its (same-site) cover through both runs' \
   "$(q "select cover_photo_id from albums where id = 'bbbbbbbb-0000-0000-0000-000000000001'")" \
   'cccccccc-0000-0000-0000-000000000001'

# ── 3. The verify suite, against the migrated database ──────────────────────
suite="$("${PSQL[@]}" -f db/verify-album-cover-fk.sql 2>&1)"
case "$suite" in
  *'All 17 checks passed.'*) ok 'db/verify-album-cover-fk.sql: all 17 pass on the migrated key' ;;
  *) bad 'db/verify-album-cover-fk.sql on the migrated key' "$(echo "$suite" | grep -E 'FAIL|passed|failed')" ;;
esac

# ── 4. The rollback, as written in the migration's footer ───────────────────
ROLLBACK="$(sed -n '/^-- ── Rollback/,$p' "$MIG" | sed -n 's/^--   //p')"
printf '%s\n' "$ROLLBACK" | "${PSQL[@]}" -f - >/dev/null 2>&1
is 'the rollback runs' "$?" '0'
is 'the rollback restores the original key exactly' "$(def)" "$ORIGINAL"

# ── 5. The mutation: the suite must FAIL against the original key ───────────
suite="$("${PSQL[@]}" -f db/verify-album-cover-fk.sql 2>&1)"
case "$suite" in
  *'FAIL   a cover on ANOTHER SITE is refused, by the foreign key'*) ok 'MUTATION (original key): the cross-site check fails, as it must' ;;
  *) bad 'MUTATION (original key): the cross-site check did not fail' "$(echo "$suite" | grep -E 'FAIL|passed|failed')" ;;
esac
case "$suite" in
  *'All 17 checks passed.'*) bad 'MUTATION: the suite still passed in full' ;;
  *) ok "MUTATION: the suite reports $(echo "$suite" | grep -oE '[0-9]+ of 17 check\(s\) failed')" ;;
esac

dropdb --if-exists "$DB" >/dev/null 2>&1
echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
