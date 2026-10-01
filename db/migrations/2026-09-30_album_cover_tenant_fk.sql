-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-30 — P3 prerequisite: an album's chosen cover is on the album's site
--
-- claude/photo-migration-plan.md, P3 (design reconciliation, amendment 8).
--
-- `albums.cover_photo_id` references `photos(id)` alone, so the database
-- accepts an album on site A whose cover is a photograph on site B. The
-- application never offered one — the picker lists the album's own photographs
-- — but `updateAlbumSettings` stored whatever id the form posted, and the
-- renderer (`lib/album-covers.ts`) loads the cover by id with no site filter.
-- P3 projects the chosen cover into photo_usages, whose composite foreign keys
-- refuse a cross-site row, so the source must not be able to hold one either.
--
-- The foreign key becomes tenant-aware:
--
--   albums (cover_photo_id, tenant_id) → photos (id, tenant_id)
--   ON DELETE SET NULL (cover_photo_id)
--
-- The column list on SET NULL (PostgreSQL 15+) is what preserves today's
-- behaviour exactly: deleting the chosen photograph nulls the cover and
-- NOTHING ELSE. A plain `on delete set null` on a two-column key would null
-- `albums.tenant_id` as well — a NOT NULL column — and fail every photograph
-- deletion that happened to be a cover. The target, `photos_id_tenant
-- unique (id, tenant_id)`, exists since P1.
--
-- The DATABASE boundary is the same SITE. That the cover is one of the
-- album's OWN photographs is an application rule (`updateAlbumSettings`),
-- deliberately not a constraint or a trigger in P3.
--
-- ── Preflight ───────────────────────────────────────────────────────────────
-- The migration refuses, and changes nothing, if any album already names a
-- cover on another site. Production was checked independently: 0.
--
-- Safe to run twice: the constraint is dropped by name and re-added; the
-- preflight runs each time.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_crossed integer;
begin
  select count(*) into v_crossed
    from public.albums al
    join public.photos ph on ph.id = al.cover_photo_id
   where ph.tenant_id <> al.tenant_id;

  if v_crossed > 0 then
    raise exception
      'P3 prerequisite refused: % album(s) name a cover photograph on another site. Nothing was changed.',
      v_crossed
      using errcode = '23503';
  end if;
end $$;

alter table public.albums drop constraint if exists albums_cover_photo_fk;

alter table public.albums add constraint albums_cover_photo_fk
  foreign key (cover_photo_id, tenant_id) references public.photos (id, tenant_id)
  on delete set null (cover_photo_id);

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Restores the original single-column key exactly:
--
--   begin;
--   alter table public.albums drop constraint if exists albums_cover_photo_fk;
--   alter table public.albums add constraint albums_cover_photo_fk
--     foreign key (cover_photo_id) references public.photos (id) on delete set null;
--   commit;
