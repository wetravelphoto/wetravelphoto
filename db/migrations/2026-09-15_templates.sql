-- 2026-09-15 — looks (templates) as data
--
-- A look stops being code and becomes a row: which sections a page has, in
-- what order, with which design settings, plus the site-wide typography.
-- Nothing in a manifest belongs to the photographer — see the `content` flag
-- in lib/sections/registry.ts — which is what makes "switch looks, keep your
-- photographs and writing" true by construction rather than by care.
--
-- ── Why it is shaped like this ───────────────────────────────────────────────
--
-- The decision that cannot be taken back later is whether a site follows a
-- look LIVE or takes a SNAPSHOT of it.
--
-- Live means editing Field Notes redesigns every site using it, without
-- warning, including sites belonging to people who were happy. It also means
-- there is no such thing as "stay on the old one", so there is no version of
-- this that could ever be sold, staged, or rolled back.
--
-- Snapshot means a site is self-contained. Publishing a new version of a look
-- changes nothing anywhere until someone chooses it. Whether that choice is
-- free, prompted, automatic for some plans or paid for is then a product
-- decision — one that can be made in a year, changed twice, and reversed —
-- instead of an architecture decision that has already been made by accident.
--
-- Snapshot, therefore. Plus a full history, so every apply is undoable.
--
-- The `tier` columns below are read by nothing. They exist so that the day
-- plans are real, this is a value to fill in rather than a migration to write
-- against live data. lib/entitlements.ts holds the rule about what a plan is
-- allowed to take away: it may LOCK, it may not DELETE.

begin;

-- ── The looks themselves ─────────────────────────────────────────────────────

create table if not exists templates (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  blurb       text,

  -- Bumped every time the manifest is published. A site records which version
  -- it took, so this moving is never felt by anyone until they ask for it.
  version     int  not null default 1,

  -- draft: only visible to whoever is building it
  -- published: offered in the picker
  -- retired: no longer offered, but sites already on it keep working forever
  status      text not null default 'draft'
              check (status in ('draft', 'published', 'retired')),

  -- 'system' for the ones shipped with the platform, 'tenant' for one a
  -- photographer made. Here from the start so a look somebody else built is
  -- not a schema change.
  origin      text not null default 'system'
              check (origin in ('system', 'tenant')),
  author_tenant_id uuid,

  -- NULL means every plan has it, which is all of them today. NOTHING READS
  -- THIS. See the note above.
  tier        text,

  manifest    jsonb not null default '{}'::jsonb,
  preview_path text,

  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists templates_offered_idx
  on templates (status, sort_order) where status = 'published';


-- Every published version, kept forever.
--
-- This is what makes "stay on version 2" and "go back to version 2" possible
-- at all. Without it, a look only exists in its newest form and the promise
-- that publishing does not disturb anyone is unenforceable.

create table if not exists template_versions (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  version     int  not null,
  manifest    jsonb not null,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (template_id, version)
);


-- ── What a site is using ─────────────────────────────────────────────────────

create table if not exists site_template (
  tenant_id   uuid primary key default default_tenant_id(),
  template_id uuid references templates(id) on delete set null,

  -- The version this site is ON, which may be behind the template's current
  -- one. That gap is the whole point: it is what the Design page turns into
  -- "an update is available" instead of a redesign nobody asked for.
  version     int not null default 1,

  -- The manifest AS APPLIED. A site renders from its own sections, so this is
  -- not needed to draw the page — it is here so the site can answer "what was
  -- I given?" even if the template row is later edited, retired or deleted.
  snapshot    jsonb not null default '{}'::jsonb,

  adopted_at  timestamptz not null default now()
);


-- ── The way back ─────────────────────────────────────────────────────────────
--
-- Written BEFORE any apply, never after. Holds the page exactly as it was, so
-- undo is a restore of known-good state rather than an attempt to reconstruct
-- one. Applying a look, taking an update and reverting all write a row, which
-- means revert is itself revertible.

create table if not exists site_template_history (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default default_tenant_id(),

  -- What happened: 'apply' (switched look), 'update' (same look, new version),
  -- 'revert' (went back to an earlier row).
  action      text not null check (action in ('apply', 'update', 'revert')),

  -- Where it went.
  template_id uuid references templates(id) on delete set null,
  template_slug text,
  template_name text,
  version     int,

  -- Where it came FROM — the restorable part.
  sections_before jsonb not null default '[]'::jsonb,
  styles_before   jsonb not null default '{}'::jsonb,
  from_template_id uuid,
  from_version    int,

  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists site_template_history_idx
  on site_template_history (tenant_id, created_at desc);


-- ── Row level security ───────────────────────────────────────────────────────
--
-- Two different kinds of thing here, and they are not owned by the same party.
--
-- A LOOK belongs to the platform, not to a site: everyone can see the
-- published ones, and only a platform admin publishes. When photographers can
-- author their own, that write check becomes
-- `author_tenant_id = current_tenant_id() or is_platform_admin()` — the column
-- is already there for it.
--
-- WHICH LOOK A SITE IS USING, and its history, belong to that site, and use
-- the same owner policy as every other tenant-owned table.

alter table templates enable row level security;
alter table template_versions enable row level security;
alter table site_template enable row level security;
alter table site_template_history enable row level security;

drop policy if exists "Anyone reads published templates" on templates;
create policy "Anyone reads published templates" on templates
  for select using (status <> 'draft');

-- A site has to read the archived manifest of the version it is on, and of the
-- one being offered to it.
drop policy if exists "Anyone reads template versions" on template_versions;
create policy "Anyone reads template versions" on template_versions
  for select using (true);

do $$
begin
  if to_regprocedure('public.apply_tenant_policy(regclass)') is null then
    raise exception
      'Run db/migrations/2026-09-15_tenant_scoping.sql first — it defines the owner policy these tables need.';
  end if;

  drop policy if exists "Owners manage templates" on templates;
  drop policy if exists "Platform admins manage templates" on templates;
  create policy "Platform admins manage templates" on templates
    for all
    using (public.is_platform_admin())
    with check (public.is_platform_admin());

  drop policy if exists "Owners read template versions" on template_versions;
  drop policy if exists "Platform admins manage template versions" on template_versions;
  create policy "Platform admins manage template versions" on template_versions
    for all
    using (public.is_platform_admin())
    with check (public.is_platform_admin());

  drop policy if exists "Owners manage site template" on site_template;
  perform public.apply_tenant_policy('site_template');

  drop policy if exists "Owners read template history" on site_template_history;
  perform public.apply_tenant_policy('site_template_history');
end $$;


-- ── Field Notes v1 ───────────────────────────────────────────────────────────
--
-- Built from THIS site as it stands, so adopting it is a no-op: the same
-- sections, in the same order, with the same switches and the same
-- typography. That is deliberate — the first look has to prove that applying
-- one changes nothing it should not, and the only way to prove it is to make
-- it verifiable on a site whose before and after you can compare.
--
-- Design settings only. No headings, no photographs, no body copy.

insert into templates (slug, name, blurb, status, origin, sort_order, manifest, published_at)
select
  'field-notes',
  'Field Notes',
  'Condensed capitals, wide letterspacing, generous mats. Editorial and quiet.',
  'published',
  'system',
  0,
  jsonb_build_object(
    'schema', 1,
    'styles', jsonb_build_object('type_styles', coalesce(s.type_styles, '{}'::jsonb)),
    'pages', jsonb_build_object('home', jsonb_build_array(
      jsonb_build_object(
        'type', 'hero', 'visible', true, 'version', 1,
        'settings', jsonb_build_object(
          'mode',           coalesce(s.hero_mode, 'stories'),
          'title_position', coalesce(s.hero_title_position, 'center'),
          'story_align',    coalesce(s.hero_story_align, 'left'),
          'show_mark',      coalesce(s.hero_show_mark, true)
        )
      ),
      jsonb_build_object(
        'type', 'intro', 'visible', coalesce(s.show_intro, true), 'version', 1,
        'settings', jsonb_build_object('image_side', coalesce(s.intro_image_side, 'left')),
        'demo', jsonb_build_object(
          'kicker',  'Selected work',
          'heading', 'A line about who you are',
          'body',    'Two or three sentences about the work — where you shoot, what you are drawn to, how someone can work with you.'
        )
      ),
      jsonb_build_object(
        'type', 'galleries', 'visible', coalesce(s.show_galleries, true), 'version', 1,
        'settings', jsonb_build_object('limit', 0),
        'demo', jsonb_build_object('heading', 'Recent trips')
      ),
      jsonb_build_object(
        'type', 'journal', 'visible', coalesce(s.show_journal, true), 'version', 1,
        'settings', jsonb_build_object('count', coalesce(s.journal_count, 3)),
        'demo', jsonb_build_object('heading', 'From the journal', 'cta_label', 'View all stories')
      ),
      jsonb_build_object(
        'type', 'instagram', 'visible', coalesce(s.show_instagram, false), 'version', 1,
        'settings', jsonb_build_object('count', 9),
        'demo', jsonb_build_object('heading', 'Instagram')
      ),
      jsonb_build_object(
        'type', 'contact', 'visible', coalesce(s.show_contact_section, true), 'version', 1,
        'settings', jsonb_build_object('image_side', coalesce(s.contact_image_side, 'left')),
        'demo', jsonb_build_object('heading', 'Get in touch', 'eyebrow', 'Say hello')
      )
    ))
  ),
  now()
from site_settings s
where s.id = 1
  and not exists (select 1 from templates t where t.slug = 'field-notes');

-- Version 1 archived the moment it is published.
insert into template_versions (template_id, version, manifest, notes)
select t.id, t.version, t.manifest, 'Lifted from the live site.'
  from templates t
 where t.slug = 'field-notes'
   and not exists (
     select 1 from template_versions v
      where v.template_id = t.id and v.version = t.version
   );

-- And this site is on it, at the version it was lifted from.
insert into site_template (template_id, version, snapshot)
select t.id, t.version, t.manifest
  from templates t
 where t.slug = 'field-notes'
   and not exists (select 1 from site_template where tenant_id = default_tenant_id());

commit;


-- ── Verify ───────────────────────────────────────────────────────────────────
--
--   select t.slug, t.name, t.version, t.status,
--          (select count(*) from template_versions v where v.template_id = t.id) as versions,
--          jsonb_array_length(t.manifest -> 'pages' -> 'home') as home_sections
--     from templates t;
--
-- Expect one row: field-notes, v1, published, 1 version, 6 home sections.
--
--   select template_id, version, adopted_at from site_template;
--
-- Expect one row pointing at it. Nothing on the live page changes — the look
-- was lifted from the page, not imposed on it.
--
-- Then reload PostgREST or the new tables read as missing:
--
--   notify pgrst, 'reload schema';
