-- ═══════════════════════════════════════════════════════════════════════════
-- THE COLUMN THREE CODE PATHS ALREADY DEPEND ON
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `albums.allow_downloads` is read in three places and has never existed:
--
--   · lib/gallery-access.ts  `albumsForAccess()`  — the galleries a share link
--     opens
--   · lib/gallery-access.ts  the single-album share lookup
--   · lib/album-access.ts    `downloadableAlbum()` — the gate on a public
--     album's zip
--
-- PostgREST refuses a select naming a column that is not there, so all three
-- return nothing. The consequences differ in seriousness:
--
--   · the zip gate returns null, so public downloads are simply refused —
--     broken, but failing closed, which is why nobody noticed;
--   · `albumsForAccess()` returns an EMPTY LIST, so **anybody opening a share
--     link sees a gallery page with no galleries in it.** Private client
--     galleries — the thing proofing is built on — do not work at all.
--
-- Found on 2026-09-24 by a completely unrelated failure: seeding a sample
-- gallery tried to set `allow_downloads` and was told the column does not
-- exist. `db/test-fixture.sql` has it, which is why every local test passed.
-- That file is now wrong for the third time; it is corrected in this commit.
--
-- **Default false.** The two readers disagreed about the default — the zip
-- gate demands `=== true`, the share page shows the button unless `=== false`
-- — and a column that exists settles it in the safe direction: downloads are
-- off until a photographer turns them on. Nothing changes for any existing
-- gallery, because none of them could download anything anyway.
--
-- **There is no switch for it yet.** No admin screen writes this column, so
-- after this migration downloads stay off everywhere until one is built. That
-- is a smaller gap than share links not working, and it is now visible rather
-- than hidden behind a query that silently returned nothing.
--
-- Safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════

alter table albums add column if not exists allow_downloads boolean not null default false;

comment on column albums.allow_downloads is
  'Whether a visitor may download the originals from this gallery. Read by '
  'lib/album-access.ts and lib/gallery-access.ts. Off until a photographer '
  'turns it on — no admin screen writes it yet.';

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTERWARDS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- It is there (expect one row):
--
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'albums'
--      and column_name = 'allow_downloads';
--
-- And PostgREST has noticed. It caches the schema, and that cache is what
-- produced the original "could not find the column" message, so if a select
-- still fails after this, this is the fix:
--
--   notify pgrst, 'reload schema';
--
-- Then open a share link and confirm the galleries are listed.
-- ═══════════════════════════════════════════════════════════════════════════
