-- ════════════════════════════════════════════════════════════════════════════
-- 2026-11-22 — Client gallery v2: allow albums.layout_style = 'square'
--
-- CANDIDATE — NOT DEPLOYED. Rehearsed only on loopback scratch databases.
--
-- The gallery editor offers a "square" layout and saves it through
-- updateAlbum / updateLayoutStyle, but production's check admits only three
-- values, so the save is refused (23514). Production's definition, as found:
--
--   albums_layout_style_check
--     CHECK ((layout_style = ANY (ARRAY['masonry'::text, 'grid'::text, 'single_column'::text])))
--
-- This replaces that one constraint, under the same name, with the same three
-- values in the same order plus 'square' — and nothing else:
--
--   · no other value (no 'editorial');
--   · the column, its type, NOT NULL and its default ('masonry') untouched —
--     asserted before and after;
--   · no row is written: every existing value is one of the three, all still
--     admitted, and the replacement is validated against the table as it is;
--   · no grant, policy, function, trigger or index changes.
--
-- Drift is refused rather than repaired. The constraint is replaced only when
-- its definition is EXACTLY the three-value one above; when it is already the
-- four-value one below this is a no-op (safe to run twice); any other state —
-- missing, another definition, on another table, NOT VALID, NO INHERIT, or the
-- column not as described — raises 42710 and the transaction changes nothing.
-- Everything is read back before COMMIT.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Fail fast rather than queue every reader behind a waiting ACCESS EXCLUSIVE.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- pg_get_constraintdef() / pg_get_expr() qualify names only when the schema is
-- not on the path; fixed for this transaction so the comparisons are like for
-- like.
set local search_path = public, pg_catalog;

-- DROP / ADD CONSTRAINT take ACCESS EXCLUSIVE on albums. Taken up front so the
-- check below and the change see the same table and nothing is upgraded
-- half-way. albums is small (8 rows at the last record); the hold is
-- milliseconds. If the lock is not granted within lock_timeout the migration
-- aborts, changing nothing; re-run it.
lock table public.albums in access exclusive mode;

do $$
declare
  c_name    constant text := 'albums_layout_style_check';
  c_old     constant text := 'CHECK ((layout_style = ANY (ARRAY[''masonry''::text, ''grid''::text, ''single_column''::text])))';
  c_new     constant text := 'CHECK ((layout_style = ANY (ARRAY[''masonry''::text, ''grid''::text, ''single_column''::text, ''square''::text])))';
  c_default constant text := '''masonry''::text';
  v_def      text;
  v_valid    boolean;
  v_noinh    boolean;
  v_type     text;
  v_notnull  boolean;
  v_coldef   text;
  v_rows_before text;
  v_rows_after  text;
begin
  -- ── The column, as described ────────────────────────────────────────────
  select format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    into v_type, v_notnull, v_coldef
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.albums'::regclass and a.attname = 'layout_style' and not a.attisdropped;
  if v_type is distinct from 'text' or v_notnull is not true or v_coldef is distinct from c_default then
    raise exception 'albums.layout_style is not as described: type %, not null %, default %',
      v_type, v_notnull, v_coldef using errcode = '42710';
  end if;

  -- ── The constraint: exactly one of two known states, or refuse ──────────
  -- Looked up by name in the whole schema: a same-named constraint on another
  -- table is as much drift as a wrong definition.
  if exists (select 1 from pg_constraint c
              where c.conname = c_name and c.connamespace = 'public'::regnamespace
                and c.conrelid <> 'public.albums'::regclass) then
    raise exception '% exists on another table', c_name using errcode = '42710';
  end if;

  select pg_get_constraintdef(c.oid), c.convalidated, c.connoinherit
    into v_def, v_valid, v_noinh
    from pg_constraint c
   where c.conname = c_name and c.connamespace = 'public'::regnamespace
     and c.conrelid = 'public.albums'::regclass and c.contype = 'c';

  if v_def is null then
    raise exception '% is missing on albums; refusing to create it from nothing', c_name using errcode = '42710';
  elsif not v_valid or v_noinh then
    raise exception '% is NOT VALID or NO INHERIT: refusing', c_name using errcode = '42710';
  elsif v_def = c_new then
    -- Already applied: nothing to do.
    null;
  elsif v_def = c_old then
    -- A row-content fingerprint, so "no data change" is measured, not assumed.
    select coalesce(md5(string_agg(id::text || ':' || layout_style || ':' || updated_at::text, ',' order by id)), '')
      into v_rows_before from public.albums;

    alter table public.albums drop constraint albums_layout_style_check;
    alter table public.albums add constraint albums_layout_style_check
      check (layout_style in ('masonry', 'grid', 'single_column', 'square'));

    select coalesce(md5(string_agg(id::text || ':' || layout_style || ':' || updated_at::text, ',' order by id)), '')
      into v_rows_after from public.albums;
    if v_rows_after is distinct from v_rows_before then
      raise exception 'albums rows changed during the constraint swap' using errcode = '42P17';
    end if;
  else
    raise exception '% exists with another definition: %', c_name, v_def using errcode = '42710';
  end if;

  -- ── Read back: what is in the catalogue now is exactly what was meant ───
  select pg_get_constraintdef(c.oid), c.convalidated, c.connoinherit
    into v_def, v_valid, v_noinh
    from pg_constraint c
   where c.conname = c_name and c.connamespace = 'public'::regnamespace
     and c.conrelid = 'public.albums'::regclass and c.contype = 'c';
  if v_def is distinct from c_new or v_valid is not true or v_noinh is not false then
    raise exception '% did not come out as defined: % (valid %, no inherit %)',
      c_name, v_def, v_valid, v_noinh using errcode = '42P17';
  end if;

  if (select count(*) from pg_constraint c
       where c.conname = c_name and c.connamespace = 'public'::regnamespace) <> 1 then
    raise exception 'more than one % in public', c_name using errcode = '42P17';
  end if;

  -- The default and the column are unchanged.
  select format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    into v_type, v_notnull, v_coldef
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.albums'::regclass and a.attname = 'layout_style' and not a.attisdropped;
  if v_type is distinct from 'text' or v_notnull is not true or v_coldef is distinct from c_default then
    raise exception 'albums.layout_style changed: type %, not null %, default %',
      v_type, v_notnull, v_coldef using errcode = '42P17';
  end if;
end $$;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Back to the three-value check. It FAILS (23514, nothing changed) if any album
-- has been saved as 'square' meanwhile — which is correct: decide what those
-- albums become, under its own approval, before narrowing the rule again.
--
--   begin;
--   set local lock_timeout = '5s';
--   lock table public.albums in access exclusive mode;
--   alter table public.albums drop constraint albums_layout_style_check;
--   alter table public.albums add constraint albums_layout_style_check
--     check (layout_style in ('masonry', 'grid', 'single_column'));
--   commit;
