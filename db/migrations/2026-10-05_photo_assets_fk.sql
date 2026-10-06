-- ════════════════════════════════════════════════════════════════════════════
-- 2026-10-05 — P4, unit 2 of 2: photos and site_images point at real assets
--
-- claude/photo-migration-plan.md, P4. Applied only AFTER unit 1
-- (2026-10-05_photo_backfill.sql) is deployed, the backfill has run with
-- --apply, and its own report shows nothing refused or failed.
--
-- P1 left `photos.asset_id` and `site_images.asset_id` without a foreign key,
-- deliberately, so an empty column could not fail one. This adds them, tenant-
-- aware, the shape every other photo key has:
--
--   photos      (asset_id, tenant_id) → photo_assets (id, tenant_id)
--   site_images (asset_id, tenant_id) → photo_assets (id, tenant_id)
--
-- NO ACTION on delete (the default): an asset a row still points at cannot be
-- deleted — P6's deletion work starts from that refusal. Deleting a SITE still
-- works: tenants cascade to photos, site_images and photo_assets in one
-- statement, and NO ACTION is checked at its end, when all three are gone.
-- MATCH SIMPLE (the default): a NULL asset_id is not checked, which is what
-- lets the built-in sample photographs keep theirs NULL for good.
--
-- One supporting index each, so deleting or re-keying an asset does not scan
-- the table to find who points at it.
--
-- ── A foreign key that applies is NOT proof the backfill was complete ───────
--
-- A NULL asset_id passes any foreign key. So the PREFLIGHT proves completeness
-- separately, and refuses — changing nothing — unless all five are zero:
--
--   1. non-sample photos rows with no asset_id
--   2. site_images rows with no asset_id
--   3. rows whose asset_id names no asset of THEIR OWN site (dangling or
--      cross-site — the key would refuse these too; counted here to say why)
--   4. built-in sample rows WITH an asset_id (a sample is never an asset)
--   5. linked rows whose storage_path is not their asset's display_path (the
--      row and its asset disagree about which file is shown)
--
-- A sample is `/samples/<name>/<name>.webp` — isSamplePhoto() in lib/images.ts,
-- whose `\w` is ASCII; .mk/backfill.ts holds the two to the same answers.
--
-- Safe to run twice: an existing constraint is checked against the exact
-- definition and left alone; any other definition under the same name refuses.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- pg_get_constraintdef() writes a table's schema only when it is not on the
-- path; fixed for this transaction so the definition check below compares
-- like with like wherever this runs.
set local search_path = public, pg_catalog;

-- ── Hold still, then look ────────────────────────────────────────────────────
-- The preflight below reads committed rows. Without a lock, a photograph
-- inserted (or unlinked) after that read and before the keys exist would be
-- missed — and a NULL asset_id passes the key, so nothing would ever say so.
-- SHARE ROW EXCLUSIVE on the three tables waits for every open writer to
-- finish and holds new ones off until COMMIT: the rows the preflight counts
-- are the rows the keys are added over. (It is also the lock ADD FOREIGN KEY
-- needs, so this adds no wait the DDL would not have had.) Readers are not
-- blocked. The ORDER is fixed — photo_assets, then photos, then site_images —
-- matching the P2 wrappers and the backfill (an asset, then the row that points
-- at it). It does NOT make a deadlock impossible: a transaction that touches
-- these tables in another order — deleteSite removes photos before the site's
-- assets cascade — can meet this migration in the opposite order. PostgreSQL
-- then detects the deadlock and aborts one transaction (40P01); if it is this
-- one, the whole migration rolls back and nothing is changed. Apply it in a
-- quiet window (no site deletions, no backfill running) and simply re-run it
-- if it is refused.
lock table public.photo_assets, public.photos, public.site_images in share row exclusive mode;

do $$
declare
  c_sample constant text := '^/samples/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.webp$';
  v_photos     integer;
  v_images     integer;
  v_dangling   integer;
  v_samples    integer;
  v_disagree   integer;
begin
  select count(*) into v_photos
    from public.photos ph
   where ph.asset_id is null and ph.storage_path !~ c_sample;

  select count(*) into v_images
    from public.site_images si
   where si.asset_id is null;

  select (select count(*) from public.photos ph
           where ph.asset_id is not null
             and not exists (select 1 from public.photo_assets a
                              where a.id = ph.asset_id and a.tenant_id = ph.tenant_id))
       + (select count(*) from public.site_images si
           where si.asset_id is not null
             and not exists (select 1 from public.photo_assets a
                              where a.id = si.asset_id and a.tenant_id = si.tenant_id))
    into v_dangling;

  select count(*) into v_samples
    from public.photos ph
   where ph.asset_id is not null and ph.storage_path ~ c_sample;

  select (select count(*) from public.photos ph
            join public.photo_assets a on a.id = ph.asset_id and a.tenant_id = ph.tenant_id
           where a.display_path is distinct from ph.storage_path)
       + (select count(*) from public.site_images si
            join public.photo_assets a on a.id = si.asset_id and a.tenant_id = si.tenant_id
           where a.display_path is distinct from si.storage_path)
    into v_disagree;

  if v_photos + v_images + v_dangling + v_samples + v_disagree > 0 then
    raise exception
      'P4 foreign keys refused: % unlinked photograph(s), % unlinked Uploads row(s), % link(s) to no asset of the row''s own site, % sample(s) with an asset, % row(s) disagreeing with their asset''s display path. Nothing was changed.',
      v_photos, v_images, v_dangling, v_samples, v_disagree
      using errcode = '23503';
  end if;
end $$;

do $$
declare
  c_def constant text := 'FOREIGN KEY (asset_id, tenant_id) REFERENCES photo_assets(id, tenant_id)';
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c where c.conrelid = 'public.photos'::regclass and c.conname = 'photos_asset_fk';
  if v_def is null then
    alter table public.photos add constraint photos_asset_fk
      foreign key (asset_id, tenant_id) references public.photo_assets (id, tenant_id);
  elsif v_def <> c_def then
    raise exception 'photos_asset_fk exists with another definition: %', v_def using errcode = '42710';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c where c.conrelid = 'public.site_images'::regclass and c.conname = 'site_images_asset_fk';
  if v_def is null then
    alter table public.site_images add constraint site_images_asset_fk
      foreign key (asset_id, tenant_id) references public.photo_assets (id, tenant_id);
  elsif v_def <> c_def then
    raise exception 'site_images_asset_fk exists with another definition: %', v_def using errcode = '42710';
  end if;

  -- And read back: what is in the catalogue now is exactly what was meant.
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = 'public.photos'::regclass and c.conname = 'photos_asset_fk') is distinct from c_def
  or (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = 'public.site_images'::regclass and c.conname = 'site_images_asset_fk') is distinct from c_def then
    raise exception 'the asset foreign keys did not come out as defined' using errcode = '42P17';
  end if;
end $$;

-- The supporting indexes, held to their exact shape like the keys: created
-- when absent; an index of the same name with any other definition (another
-- table, columns, predicate, method, uniqueness) or left invalid refuses
-- rather than being taken for the real one. `public` off the path so
-- pg_get_indexdef() always names the table in full.
set local search_path = pg_catalog;

do $$
declare
  r record;
  v_def text;
  v_valid boolean;
begin
  for r in
    select * from (values
      ('photos_asset_tenant',
       'CREATE INDEX photos_asset_tenant ON public.photos USING btree (asset_id, tenant_id) WHERE (asset_id IS NOT NULL)',
       'create index photos_asset_tenant on public.photos (asset_id, tenant_id) where asset_id is not null'),
      ('site_images_asset_tenant',
       'CREATE INDEX site_images_asset_tenant ON public.site_images USING btree (asset_id, tenant_id) WHERE (asset_id IS NOT NULL)',
       'create index site_images_asset_tenant on public.site_images (asset_id, tenant_id) where asset_id is not null')
    ) v(name, def, ddl)
  loop
    select pg_catalog.pg_get_indexdef(i.indexrelid), i.indisvalid into v_def, v_valid
      from pg_catalog.pg_index i
      join pg_catalog.pg_class c on c.oid = i.indexrelid
     where c.relname = r.name and c.relnamespace = 'public'::regnamespace;
    if v_def is null then
      execute r.ddl;
    elsif v_def <> r.def or not v_valid then
      raise exception '% exists with another definition (or invalid): %', r.name, v_def using errcode = '42710';
    end if;
    select pg_catalog.pg_get_indexdef(i.indexrelid) into v_def
      from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid = i.indexrelid
     where c.relname = r.name and c.relnamespace = 'public'::regnamespace;
    if v_def is distinct from r.def then
      raise exception '% did not come out as defined: %', r.name, v_def using errcode = '42P17';
    end if;
  end loop;
end $$;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Removes exactly what this file added; no row changes.
--
--   begin;
--   alter table public.photos      drop constraint if exists photos_asset_fk;
--   alter table public.site_images drop constraint if exists site_images_asset_fk;
--   drop index if exists public.photos_asset_tenant;
--   drop index if exists public.site_images_asset_tenant;
--   commit;
