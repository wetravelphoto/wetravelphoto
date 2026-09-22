-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-22 — Photographs uploaded from inside the editor
--
-- Until now a photograph could only reach a page by being uploaded into a
-- gallery first, in Admin, and galleries are public things. A picture for the
-- About page, a texture behind a heading, a portrait for the footer — none of
-- those belong in a gallery, so there was nowhere to put them.
--
-- site_images is that somewhere: every photograph uploaded from the editor's
-- photo picker, newest first, for this site only. It is not a gallery and is
-- never shown to a visitor; it is the list the picker offers under "Uploads"
-- so a photograph can be used again tomorrow instead of being uploaded twice.
--
-- The file itself is in R2 under the site's own prefix (t/<tenant>/site-images
-- /<uuid>/…), with the same display sizes every other photograph gets. The row
-- points at them; deleting the row leaves the files, which cost nothing and
-- may still be referenced by a published page.
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists site_images (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade
                default public.tenant_for_insert(),
  -- What a page should reference: the largest display size.
  storage_path  text not null,
  -- The untouched upload, kept so the sizes can be rebuilt one day.
  original_path text,
  -- { "400": key, "800": key, … } as lib/derivatives.ts writes them.
  derivatives   jsonb not null default '{}'::jsonb,
  width         integer,
  height        integer,
  bytes         bigint,
  -- The name of the file as it left the photographer's computer, so the
  -- picker can say "dunes-03.jpg" rather than a uuid.
  filename      text,
  created_by    uuid references profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists site_images_newest on site_images (tenant_id, created_at desc);

select public.apply_tenant_policy('site_images');
revoke all on site_images from anon;
grant select, insert, update, delete on site_images to authenticated;

commit;

notify pgrst, 'reload schema';

-- ── Check ───────────────────────────────────────────────────────────────────
--   select filename, width, height, created_at
--     from site_images order by created_at desc;
