-- ════════════════════════════════════════════════════════════════════════════
-- The accent mark becomes a section.
--
-- It used to be drawn inside the hero from three site_settings columns
-- (show_bird, logo_bird_path, logo_bird_size). The code no longer does that:
-- it is now a `mark` section, so without this migration a site that has
-- materialized its homepage would simply lose its mark.
--
-- For every site whose homepage lives in page_sections and has no mark yet,
-- this puts one directly after the hero — exactly where it always appeared —
-- carrying the same picture, size and visibility. A site that never uploaded
-- its own mark used the built-in file, and keeps it.
--
-- It also updates an open canvas DRAFT the same way. Publish replaces the live
-- sections with the draft's copy wholesale, so a draft left without the mark
-- would remove it again on the next Publish.
--
-- SAFE TO RUN TWICE: sites and drafts that already have a mark are skipped.
-- NOTHING IS DROPPED: the three old columns stay, and the canvas keeps them in
-- step on publish, so rolling the code back still shows the same mark.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  site     record;
  hero_pos int;
  mark     jsonb;
  d        record;
  arr      jsonb;
begin
  -- ── Live section rows ──────────────────────────────────────────────────────
  for site in
    select distinct ps.tenant_id
      from page_sections ps
     where ps.page = 'home'
       and not exists (
         select 1 from page_sections m
          where m.tenant_id = ps.tenant_id and m.page = 'home' and m.type = 'mark'
       )
  loop
    select coalesce(min(position), -1) into hero_pos
      from page_sections
     where tenant_id = site.tenant_id and page = 'home' and type = 'hero';

    -- Make room directly after the hero.
    update page_sections
       set position = position + 1
     where tenant_id = site.tenant_id and page = 'home' and position > hero_pos;

    insert into page_sections (tenant_id, page, type, position, visible, version, settings)
    select site.tenant_id, 'home', 'mark', hero_pos + 1,
           coalesce(s.show_bird, true),
           1,
           jsonb_build_object(
             'image_path', coalesce(s.logo_bird_path, '/logos/we-travel-photo-bird.svg'),
             'align',      'center',
             'size',       coalesce(s.logo_bird_size, 64)
           )
      from (select 1) one
      left join site_settings s on s.tenant_id = site.tenant_id;
  end loop;

  -- ── Open drafts ────────────────────────────────────────────────────────────
  for d in
    select sd.tenant_id, sd.pages -> 'home' as home
      from site_draft sd
     where jsonb_typeof(sd.pages -> 'home') = 'array'
       and not exists (
         select 1 from jsonb_array_elements(sd.pages -> 'home') e
          where e ->> 'type' = 'mark'
       )
  loop
    select jsonb_build_object(
             'id',       gen_random_uuid()::text,
             'type',     'mark',
             'visible',  coalesce(s.show_bird, true),
             'version',  1,
             'position', 0,
             'settings', jsonb_build_object(
               'image_path', coalesce(s.logo_bird_path, '/logos/we-travel-photo-bird.svg'),
               'align',      'center',
               'size',       coalesce(s.logo_bird_size, 64)
             )
           )
      into mark
      from (select 1) one
      left join site_settings s on s.tenant_id = d.tenant_id;

    -- Ordinality is 1-based. Existing sections take even slots, the mark takes
    -- the odd slot right after the hero (or slot 1, i.e. first, if there is no
    -- hero). Then positions are rewritten 0..n in the new order.
    with ordered as (
      select e.value as el, (e.ord * 2) as slot
        from jsonb_array_elements(d.home) with ordinality as e(value, ord)
      union all
      select mark,
             coalesce(
               (select h.ord * 2 + 1
                  from jsonb_array_elements(d.home) with ordinality as h(value, ord)
                 where h.value ->> 'type' = 'hero'
                 order by h.ord
                 limit 1),
               1)
    ),
    numbered as (
      select jsonb_set(el, '{position}', to_jsonb((row_number() over (order by slot)) - 1)) as el,
             slot
        from ordered
    )
    select jsonb_agg(el order by slot) into arr from numbered;

    update site_draft
       set pages = jsonb_set(pages, '{home}', arr)
     where tenant_id = d.tenant_id;
  end loop;
end
$$;

commit;

-- Check: every materialized homepage now has exactly one mark, after the hero.
--   select tenant_id, type, position, visible, settings
--     from page_sections where page = 'home' order by tenant_id, position;
--   select tenant_id, jsonb_path_query_array(pages, '$.home[*].type') from site_draft;
