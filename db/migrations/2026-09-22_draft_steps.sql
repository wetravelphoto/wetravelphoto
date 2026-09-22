-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-22 — Undo and redo inside the editor
--
-- Every edit in the canvas rewrites the site's one draft row (site_draft).
-- Before it does, the draft as it WAS is kept here as a step, so Undo can put
-- it back and Redo can take it forward again.
--
-- ── Why whole snapshots ─────────────────────────────────────────────────────
-- A list of "inverse operations" (un-reorder, un-rename, un-recolour…) would
-- need a hand-written opposite for every action the editor has now and every
-- one it gains later, and the first one somebody forgets is an Undo that does
-- the wrong thing. A snapshot of the draft cannot disagree with the draft.
-- A draft is a few tens of kilobytes, and only the newest 50 steps are kept.
--
-- ── Bursts are one step ─────────────────────────────────────────────────────
-- Typing a heading saves every half second, and dragging a slider saves every
-- quarter second. Each of those is not an Undo step: the whole burst is. The
-- app names each edit ("Introduction on the Homepage", "Site style"), and
-- push_draft_step keeps a new step only when the edit is to something else,
-- or when the last save was more than 1.5 seconds ago.
--
-- site_draft.edit_label is the name of the last edit that was SAVED. Undo and
-- Redo set it to null, so the first edit after an Undo always starts a fresh
-- step instead of being folded into one that is no longer on top.
--
-- ── Lifetime ────────────────────────────────────────────────────────────────
-- Steps belong to the draft. Publish and Discard clear them: the site's
-- version history (site_template_history) is the way back from a publish.
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists site_draft_steps (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade
              default public.tenant_for_insert(),

  -- 'undo': states behind the current one. 'redo': states undone, ahead of it.
  stack       text not null check (stack in ('undo', 'redo')),

  -- { pages, global_styles, type_styles } — the same three columns as
  -- site_draft, as they were.
  snapshot    jsonb not null,

  -- What the step changed, for the button's tooltip: "Introduction on the
  -- Homepage". Shown to the photographer, never interpreted.
  label       text,

  created_at  timestamptz not null default clock_timestamp()
);

create index if not exists site_draft_steps_top
  on site_draft_steps (tenant_id, stack, id desc);

comment on table site_draft_steps is
  'Undo/redo snapshots of site_draft, newest 50 kept. Cleared on Publish and Discard.';

-- Unpublished work, like the draft itself: only the site's own editors (or a
-- platform admin) can see or change it, and nobody anonymous at all.
select public.apply_tenant_policy('site_draft_steps');
revoke all on site_draft_steps from anon;
grant select, insert, update, delete on site_draft_steps to authenticated;
grant usage, select on sequence site_draft_steps_id_seq to authenticated;

-- The name of the edit that last wrote the draft (see the header).
alter table site_draft add column if not exists edit_label text;


-- ── Keeping a step ──────────────────────────────────────────────────────────
--
-- Called by the app just BEFORE it writes an edit to the draft, with the draft
-- as it is at that moment. In one place and in the database so the "how long
-- since the last save" question is answered by one clock.
--
-- SECURITY INVOKER: it runs with the caller's own rights, so row-level
-- security still decides which site's rows it can touch. A caller naming
-- another site's id changes nothing.
create or replace function public.push_draft_step(
  p_tenant   uuid,
  p_snapshot jsonb,
  p_label    text,
  p_window   interval default interval '1.5 seconds',
  p_keep     int      default 50
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  last_label text;
  last_write timestamptz;
begin
  -- A new edit makes whatever was undone unreachable, as in every editor.
  delete from site_draft_steps where tenant_id = p_tenant and stack = 'redo';

  select edit_label, updated_at
    into last_label, last_write
    from site_draft
   where tenant_id = p_tenant;

  -- Still the same burst: the same thing edited, moments ago. The step kept
  -- at the start of the burst already holds the state before it.
  if last_label is not null
     and last_label = p_label
     and last_write > clock_timestamp() - p_window then
    return;
  end if;

  insert into site_draft_steps (tenant_id, stack, snapshot, label)
  values (p_tenant, 'undo', p_snapshot, p_label);

  -- Newest p_keep only.
  delete from site_draft_steps
   where tenant_id = p_tenant
     and stack = 'undo'
     and id not in (
       select id from site_draft_steps
        where tenant_id = p_tenant and stack = 'undo'
        order by id desc
        limit p_keep
     );
end $$;

revoke all on function public.push_draft_step(uuid, jsonb, text, interval, int) from public, anon;
grant execute on function public.push_draft_step(uuid, jsonb, text, interval, int) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ── Check ───────────────────────────────────────────────────────────────────
-- Expect 0 rows now. Edit something in the canvas and run it again: one row
-- per step, newest first.
--
--   select id, stack, label, created_at from site_draft_steps order by id desc;
