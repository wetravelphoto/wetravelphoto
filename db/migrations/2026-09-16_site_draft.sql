-- 2026-09-16 — the draft layer
--
-- What the canvas edits. Everything typed, dragged or recoloured in the editor
-- lands here first; the live page does not change until Publish.
--
-- ONE ROW PER SITE, HOLDING A SNAPSHOT — not a shadow copy of page_sections
-- with a status column. The shadow-row design looks tidier on a whiteboard and
-- is worse in every other way: every read path in the app then has to know
-- which layer it is reading, and the day one of them forgets is the day an
-- unpublished homepage goes live. A blob has exactly one reader
-- (lib/drafts/store.ts) and the public site's read path is untouched by this
-- migration — app/page.tsx does not know drafts exist.
--
-- Publishing is therefore not a state transition on a hundred rows. It is:
-- read the blob, write an undo point, call replaceSections() and
-- patchSiteSettings() — the same two functions applying a look already uses —
-- then delete the row. Discarding is deleting the row.
--
-- The cost, stated honestly: a draft holds section settings as they were
-- shaped when the draft was started, so a draft left open across a deploy that
-- bumps a section's version is read through resolveSettings() like any other
-- stored settings, and migrates on read. Drafts are hours old, not months.

begin;

create table if not exists site_draft (
  -- One draft per site. Starting a second one would mean deciding which is
  -- real, and there is no interface that asks.
  tenant_id     uuid primary key default default_tenant_id(),

  -- Page slug → the ordered section list for that page, each entry shaped like
  -- a page_sections row: { id, type, position, visible, version, settings }.
  -- The id is carried so that clicking a section in the preview still selects
  -- the same section after a refresh.
  pages         jsonb not null default '{}'::jsonb,

  -- The two style halves, same shapes as site_settings.global_styles and
  -- site_settings.type_styles. Null means "this draft has not touched style",
  -- which is different from "this draft sets style to empty" — hence null
  -- rather than '{}'.
  global_styles jsonb,
  type_styles   jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Who left this draft open. References profiles rather than auth.users:
  -- profiles.id IS the auth user id in this schema, it lives in the public
  -- schema where the rest of the app's constraints live, and it is already
  -- tenant-scoped. An app migration reaching into Supabase's auth schema works
  -- until the day it doesn't.
  updated_by    uuid references profiles (id) on delete set null
);


-- ── Row level security ───────────────────────────────────────────────────────
--
-- NOT world-readable, and this is the one place in the schema where that
-- differs from the table it shadows. page_sections is public because the live
-- page is public. A draft is unpublished work: an unannounced rebrand, a
-- gallery for a client who has not seen it, next season's prices. It belongs
-- to the site that owns it and to nobody else.

alter table site_draft enable row level security;

do $$
begin
  if to_regprocedure('public.apply_tenant_policy(regclass)') is null then
    raise exception
      'Run db/migrations/2026-09-15_tenant_scoping.sql first — it defines the owner policy this table needs.';
  end if;

  drop policy if exists "Owners manage site draft" on site_draft;
  perform public.apply_tenant_policy('site_draft');
end $$;


-- ── Publishing joins the undo list ───────────────────────────────────────────
--
-- site_template_history is already the way back from any design change, and a
-- publish is a design change. Widening the check here rather than building a
-- second history table is the whole point of having built that one: one list,
-- one Undo button, whether the change came from switching look or from the
-- canvas.

alter table site_template_history
  drop constraint if exists site_template_history_action_check;

alter table site_template_history
  add constraint site_template_history_action_check
  check (action in ('apply', 'update', 'revert', 'publish'));


-- Keep updated_at honest without every caller remembering to set it.
--
-- clock_timestamp() rather than now(): now() is the TRANSACTION's start time
-- and does not move within one, so two saves in the same transaction would
-- carry the same timestamp — and, less obviously, a test could not tell a
-- working trigger from a missing one. clock_timestamp() is the wall clock at
-- the moment of the write, which is what "updated at" is supposed to mean.
create or replace function public.touch_site_draft()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists site_draft_touch on site_draft;
create trigger site_draft_touch
  before update on site_draft
  for each row execute function public.touch_site_draft();

commit;


-- ── Verify ───────────────────────────────────────────────────────────────────
--
-- Expect an empty table. It stays empty until something is edited in the
-- canvas, and goes empty again on every Publish or Discard.
--
--   select count(*) as drafts from site_draft;
--
-- Then reload PostgREST or the new table reads as missing:
--
--   notify pgrst, 'reload schema';
--
-- With a draft open, this is what is waiting to go live:
--
--   select jsonb_pretty(pages), global_styles is not null as styled, updated_at
--     from site_draft;
