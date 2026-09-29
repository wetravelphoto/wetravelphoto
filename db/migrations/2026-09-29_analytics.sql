-- ═══════════════════════════════════════════════════════════════════════════
-- S4 — WHAT A VISIT ACTUALLY WAS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `page_views` has counted two things since it was written: somebody opened a
-- gallery, or somebody opened a story. Everything else a visitor does on a
-- photographer's site — the homepage, About, Contact, the pages they made
-- themselves — has never been recorded at all. The admin overview says so in
-- its own type:
--
--     /** Views of those galleries and stories. NOT every page of the site —
--         the site's own pages are not instrumented, and saying "page views"
--         without saying which pages is the kind of number nobody can act on. */
--
-- That is the honest version of a dashboard that cannot answer "how many
-- people came to my site this week". This migration is what lets it.
--
-- It is done now rather than later for one reason: **traffic cannot be
-- reconstructed.** Every other item on the roadmap can be built next month
-- against the same data. A week of visits that was never written down is gone.
--
-- ── Five columns, and one that is not on the list ────────────────────────────
--
-- The five asked for: `path`, `page_key`, `referrer_host`, `session_hash`,
-- `device`. And `tenant_id`, which was not, and without which none of the
-- others work:
--
--   `page_views` has no site of its own. A row hangs off an album or a story,
--   and row-level security reaches the site THROUGH that parent:
--
--       using ( tenant_of('albums', album_id) = current_tenant_id()
--            or tenant_of('blog_posts', post_id) = current_tenant_id() ... )
--
--   A homepage view has neither parent. So the policy evaluates to false for
--   every such row, and a photographer cannot read their own homepage views AT
--   ALL. The feature would be write-only: rows going in that nobody on the
--   platform is permitted to see. `tenant_id` is not an extra; it is the thing
--   that makes a view of a page belong to a site.
--
-- Existing columns are untouched. `album_id`, `post_id`, `visitor_hash` and
-- `viewed_at` keep their names, their types and their meanings, and the two
-- readers in the application keep working against them unchanged.
--
-- ── The hole this closes, which is the same hole S3 closed on the queue ──────
--
-- Today:
--
--     grant delete, insert, ... on page_views to anon, authenticated, ...
--     create policy "Anyone can record a view" on page_views
--       for insert with check (true);
--
-- `with check (true)` means what it says. Anybody at all — no account needed —
-- can POST to PostgREST and write a `page_views` row with **any** `album_id`,
-- including one belonging to a photographer they have never heard of, any
-- `visitor_hash`, and any `viewed_at`. Nothing reads those columns as a
-- security decision, so the worst of it today is a competitor able to inflate
-- or forge somebody else's numbers. After this migration the table carries a
-- `tenant_id`, which makes forgery an attribution problem rather than a
-- cosmetic one: a row says which site it belongs to, and a stranger must not
-- be the one who decides that.
--
-- So, exactly as with `jobs`: **nobody writes to this table directly.**
--
--   · the public insert policy is dropped;
--   · `anon` is left with **nothing at all** on this table; `authenticated`
--     keeps SELECT, which RLS then narrows to the site they belong to; and
--     `service_role` holds SELECT and DELETE — SELECT because a filtered
--     DELETE reads the column it filters on, and DELETE because
--     `deleteSite()` removes a site's rows. See the grants block below for the
--     whole set, which is what the migration actually states;
--   · one SECURITY DEFINER function, `record_page_view`, is the whole write
--     interface, and its only grantee is `service_role` — the browser has no
--     database path to analytics whatsoever, not even a narrow one;
--   · the function restates the site rule (a definer function is not subject
--     to RLS) and validates the RESOURCE, not just the site: an album or a
--     story must belong to the site the view is being recorded for, and the
--     `path` must be the one that resource actually lives at.
--
-- ── What is deliberately NOT here ───────────────────────────────────────────
--
-- No IP address, no user-agent string, no full referrer, no query string, no
-- cookie, no country, no third party. `device` is bucketed to one of three
-- words by the server and the string it was bucketed from is thrown away;
-- `referrer_host` is a hostname with no path and no search; `path` is a
-- pathname this function DERIVES from the resource rather than accepts.
--
-- `visitor_hash` is unchanged: sha256(ip | user-agent | today's date), which
-- rotates at midnight and so cannot follow anybody across two days. It is
-- computed and discarded in the same function call; nothing durable is kept.
-- (One thing worth knowing about it is written up in `db/schema-verified.md`:
-- the day string is a BUCKET, not a secret, so the hash is a function of
-- public inputs. Deliberately left as it is by this phase.)
--
-- `session_hash` is the opposite of `visitor_hash` in every way that matters:
-- 16 random bytes minted in the browser, kept in `sessionStorage`, and gone
-- when the tab closes. It is not derived from anything about the person or
-- their machine, and it cannot be: there is nothing to derive it from. It
-- exists to answer "did this visit go from the homepage to a gallery", and
-- nothing else.
--
-- ── AND IT IS OPTIONAL, WHICH IS A CORRECTION ───────────────────────────────
--
-- `sessionStorage` throws outright in a Safari private window and wherever a
-- browser has site data blocked. The first version of this treated that as a
-- reason to record NOTHING — no id, no request, no row — which quietly turned
-- a privacy-respecting browser into an uncounted visitor. That is systematic
-- undercounting of exactly the people most likely to have blocked storage, and
-- it made a funnel feature a precondition for the basic count.
--
-- So `session_hash` is NULLABLE and null is an ordinary value: the page view is
-- recorded, and that one row simply cannot take part in a within-visit funnel.
-- What must not happen instead is a fallback that lasts longer than the visit —
-- no cookie, no `localStorage`, no identifier derived from the request. There is
-- no substitute for a random per-tab value, and the honest answer to not having
-- one is to leave the column empty.
--
-- A session id that IS supplied is still held to exactly 32 lowercase hex
-- characters. Optional means "may be absent", not "may be anything".
--
-- Safe to run twice. Additive: no column is dropped, renamed or repurposed.
--
-- THE ONE THING THIS MIGRATION CAN REFUSE TO DO
-- ─────────────────────────────────────────────
-- `tenant_id` is backfilled from each row's album or story and then made NOT
-- NULL, and `page_views_identity` requires exactly one of page_key/album/post.
-- Both are true of every row the application has ever written, because
-- `app/api/view/route.ts` has always required an album or a post. They may not
-- be true of a row somebody POSTed to PostgREST by hand, which the open insert
-- policy allowed. Such a row cannot be attributed — there is nothing to
-- attribute it to — and this file will not invent a site for it or quietly
-- delete it. It raises, names the count, and rolls back. One query says in
-- advance whether that can happen:
--
--   select count(*) from page_views
--    where num_nonnulls(album_id, post_id) <> 1;      -- expect 0
--
-- ═══════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

begin;

-- ── 1. the columns ──────────────────────────────────────────────────────────
--
-- All nullable at first. `tenant_id` becomes NOT NULL in step 3, after it has
-- been filled in; the other five stay nullable forever, because a row written
-- before today genuinely has no path, no session and no device, and inventing
-- one would make the column lie about history.

alter table public.page_views add column if not exists tenant_id     uuid;
alter table public.page_views add column if not exists path          text;
alter table public.page_views add column if not exists page_key      text;
alter table public.page_views add column if not exists referrer_host text;
alter table public.page_views add column if not exists session_hash  text;
alter table public.page_views add column if not exists device        text;

-- ── 2. the site, filled in from the parent each row already had ─────────────

update public.page_views v
   set tenant_id = a.tenant_id
  from public.albums a
 where v.tenant_id is null and v.album_id = a.id;

update public.page_views v
   set tenant_id = p.tenant_id
  from public.blog_posts p
 where v.tenant_id is null and v.post_id = p.id;

-- ── 3. and then it is required ──────────────────────────────────────────────
--
-- The refusal described in the header. `raise exception` rather than `assert`,
-- because an assertion can be switched off by a server setting and this must
-- not be.

do $$
declare
  orphans int;
begin
  select count(*) into orphans from public.page_views where tenant_id is null;
  if orphans > 0 then
    raise exception
      'S4: % page_views row(s) carry neither an album nor a story, so they '
      'cannot be attributed to a site. Nothing has been changed. Look at them '
      '(select * from page_views where album_id is null and post_id is null) '
      'and decide: they are almost certainly rows POSTed by hand while the '
      '"Anyone can record a view" policy was open, in which case deleting them '
      'loses nothing readable — both application readers filter by album or '
      'post, so no screen has ever shown them.', orphans;
  end if;
end $$;

alter table public.page_views alter column tenant_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.page_views'::regclass
       and conname  = 'page_views_tenant_id_fkey'
  ) then
    -- ON DELETE CASCADE, matching `jobs` and matching this table's own two
    -- existing foreign keys. `app/actions/sites.ts` still deletes the rows
    -- explicitly and first; the cascade is there so that a site cannot be
    -- half-deleted by a path nobody thought of.
    alter table public.page_views
      add constraint page_views_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade;
  end if;
end $$;

-- ── 4. what each column is allowed to contain ───────────────────────────────
--
-- These say the same things `record_page_view` says. Two copies on purpose:
-- the function is the door, and the constraints are what the table is, so a
-- future writer — a migration, a backfill, somebody at a psql prompt — cannot
-- put a query string in `path` or a user-agent in `device` by going round the
-- door. Where a constraint and the function disagree the table wins, which is
-- the right way round.

do $$
begin
  -- Exactly one identity. A view is OF something: a page of the site, a
  -- gallery, or a story. Not two of them, and not none.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.page_views'::regclass
                    and conname = 'page_views_identity') then
    alter table public.page_views add constraint page_views_identity
      check (num_nonnulls(page_key, album_id, post_id) = 1);
  end if;

  -- A pathname. No query string, no fragment, no whitespace, no host.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.page_views'::regclass
                    and conname = 'page_views_path_is_a_path') then
    alter table public.page_views add constraint page_views_path_is_a_path
      check (path is null or (path ~ '^/[^?#[:space:]]*$' and length(path) <= 255));
  end if;

  -- A page key is one of the site's built-in pages or one of the
  -- photographer's own. `notfound` is a real page key and is NOT here: it has
  -- no address, so nobody can visit it.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.page_views'::regclass
                    and conname = 'page_views_page_key_shape') then
    alter table public.page_views add constraint page_views_page_key_shape
      check (page_key is null or page_key ~
        '^(home|about|contact|journal|galleries|shop|p_[a-z0-9]{8})$');
  end if;

  -- A hostname, lower-case. No scheme, no port, no path, no search — the
  -- three things a full referrer would carry and that we refuse to keep.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.page_views'::regclass
                    and conname = 'page_views_referrer_is_a_host') then
    alter table public.page_views add constraint page_views_referrer_is_a_host
      check (referrer_host is null or
             (referrer_host ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'
              and referrer_host like '%.%'));
  end if;

  -- 16 random bytes as hex. A fixed shape is what makes it checkable that
  -- nothing derived from the person — an address, an account id, a device
  -- string — has been put here instead.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.page_views'::regclass
                    and conname = 'page_views_session_shape') then
    alter table public.page_views add constraint page_views_session_shape
      check (session_hash is null or session_hash ~ '^[0-9a-f]{32}$');
  end if;

  -- Three buckets. The string they were bucketed from is never stored, and
  -- this constraint is why it cannot be: a user-agent does not fit here.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.page_views'::regclass
                    and conname = 'page_views_device_bucket') then
    alter table public.page_views add constraint page_views_device_bucket
      check (device is null or device in ('phone', 'tablet', 'desktop'));
  end if;

  -- A hash, not an address.
  --
  -- 64 characters is sha256 in hex, and the bound is the least of it. The two
  -- negative clauses are the point: no whitespace, `@` or `/` rules out a
  -- user-agent, an email and a URL, and `^[0-9.]+$` / no colon rules out an
  -- IPv4 and an IPv6 address. THIS COLUMN IS WHERE AN IP WOULD GO if anybody
  -- ever decided that hashing it was inconvenient, so the table refuses one.
  --
  -- Not tightened to `^[0-9a-f]{32}$`, which is what the route actually writes,
  -- for one reason: `db/test-fixture.sql` seeds `hash-one` and `hash-two`, and
  -- a migration that cannot be rehearsed against the fixture is a migration
  -- that gets applied to production untested. Worth revisiting when the fixture
  -- is regenerated after this deploys.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.page_views'::regclass
                    and conname = 'page_views_visitor_is_a_hash') then
    alter table public.page_views add constraint page_views_visitor_is_a_hash
      check (length(visitor_hash) between 8 and 64
             and visitor_hash !~ '[[:space:]@/:]'
             and visitor_hash !~ '^[0-9.]+$');
  end if;
end $$;

-- ── 5. indexes: two, and the reasons ────────────────────────────────────────
--
-- `page_views_album_idx (album_id, viewed_at desc)` already exists and is left
-- alone. What follows is deliberately short. An index on a table that is only
-- ever written by one function and read by one screen is a cost on every
-- single view recorded, and the way to choose them is to look at the queries
-- that exist — not at the columns that exist.
--
--   `page_views_tenant_time (tenant_id, viewed_at desc)`
--     Every read after this migration begins the same way: this site, this
--     window. `lib/admin/overview.ts` and the album stats screen both gain a
--     `tenant_id` filter in this commit, and every aggregate the analytics
--     screen will want — views, visitors, top pages, referrers, devices — is
--     a scan of one site's rows in a date range followed by a group-by. This
--     index is that scan. Without it, one site's dashboard reads every other
--     site's rows and throws them away.
--
--   `page_views_post_idx (post_id, viewed_at desc) where post_id is not null`
--     Not new work: `lib/admin/overview.ts` has always run
--     `.in('post_id', postIds).gte('viewed_at', since)` and there has never
--     been an index for it, while its album twin has had one all along. The
--     partial clause is because most rows after today will have no post at
--     all — page views outnumber story views — so indexing the nulls would be
--     most of the index doing nothing.
--
-- NOT added, on purpose:
--
--   (tenant_id, path, viewed_at) — a per-path time series. `top pages in a
--     window` does not need it: that is a range scan on tenant+time and a
--     group-by, which the index above already serves. It becomes worth having
--     when a screen asks about ONE path over time, and not before.
--   (session_hash, …) — within-session funnels are why the column exists, but
--     no query asks for one yet. The column is being recorded now because
--     history cannot be recovered; the index can be added the day the query
--     is written, in seconds, against data that is already there.
--   (referrer_host, …) and (device, …) — three values and a few dozen; a
--     group-by over one site's window reads them off the rows it already has.

create index if not exists page_views_tenant_time
  on public.page_views (tenant_id, viewed_at desc);

create index if not exists page_views_post_idx
  on public.page_views (post_id, viewed_at desc) where post_id is not null;

-- ── 6. the policy: the site, said directly ──────────────────────────────────
--
-- The old policy reached the site through `tenant_of('albums', album_id)`,
-- because there was no other way to get there. There is now, it is on the row,
-- and it is NOT NULL and filled in from exactly those parents — so the two
-- forms agree on every row that exists, and the direct one also covers the
-- rows this migration makes possible, which the old one could not see at all.
--
-- Replaced rather than added to. Two clauses where one suffices is two things
-- to keep true, and `tenant_of` is a function call per row on a table that is
-- about to get much bigger than it is today.

alter table public.page_views enable row level security;

drop policy if exists "Tenant members manage" on public.page_views;
create policy "Tenant members manage" on public.page_views for all
  using      (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

-- The open door, closed. Recording a view is now something the site's own
-- server does on a visitor's behalf, through the function below.
drop policy if exists "Anyone can record a view" on public.page_views;

-- ── 7. grants, stated in full ───────────────────────────────────────────────
--
-- S3's lesson, and it cost an afternoon: **a grant is additive.** Writing
-- `grant select on page_views to authenticated` on a database whose default
-- privileges hand out everything leaves `authenticated` holding INSERT, UPDATE
-- and DELETE as well, and the statement reads as though it does not. The only
-- way to state a privilege set is to take it away first.
--
-- Who needs what, from reading the code rather than from assuming:
--
--   authenticated  SELECT — `lib/admin/overview.ts` and
--                  `app/admin/trips/[id]/stats/page.tsx` read views through
--                  the photographer's own client, and RLS narrows them to
--                  their own site.
--   service_role   SELECT and DELETE — `app/actions/sites.ts` `deleteSite()`
--                  removes a site's rows through the admin client. (That call
--                  has never worked: it filters on `tenant_id`, which did not
--                  exist, and the resulting error is swallowed by the "table
--                  does not exist on this deployment" guard. It starts working
--                  today.) SELECT is there because **a filtered DELETE needs
--                  it**: `delete ... where tenant_id = $1` reads that column to
--                  decide which rows to remove, so DELETE alone fails with
--                  "permission denied for table page_views". Measured, by
--                  granting DELETE alone and watching db/verify-analytics.sql
--                  fail as the real role — the same shape of mistake S3 made
--                  when it granted service_role nothing at all and assumed
--                  Supabase's defaults would cover it.
--                  EXECUTE on record_page_view — the route's only writer.
--   anon           nothing at all. A visitor causes a view to be recorded;
--                  they do not get to write one.
--
-- No INSERT for anybody, including `service_role`: the function is SECURITY
-- DEFINER, so the row is written with the owner's rights, and the absence of
-- the grant is what stops the admin client from going round the validation.

revoke all on table public.page_views from public;
revoke all on table public.page_views from anon;
revoke all on table public.page_views from authenticated;
revoke all on table public.page_views from service_role;

grant select on table public.page_views to authenticated;
grant select, delete on table public.page_views to service_role;

-- ── 8. the only way in ──────────────────────────────────────────────────────
--
-- SECURITY DEFINER, `search_path = ''`, every relation and function written
-- out in full. `pg_catalog` is always searched first whatever the setting, so
-- `count`, `num_nonnulls` and the regex operators resolve; nothing else does,
-- which is the point — a schema on somebody's search path cannot shadow
-- `public.albums` for the duration of this call.
--
-- What it proves before it writes anything:
--
--   1. the site exists;
--   2. the caller is allowed to record for it — restated here because a
--      definer function is not subject to the policy above;
--   3. exactly one identity: a page of the site, a gallery, or a story;
--   4. an album or a story BELONGS TO THAT SITE. This is the one that matters:
--      without it a visitor to one photographer's site could file a view
--      against another photographer's gallery merely by naming it;
--   5. a page key is a built-in page of the site, or one of the
--      photographer's own that actually exists in their settings;
--   6. **the path is the one that resource lives at.** Not merely a
--      well-shaped path — the path derived from the resource itself. A caller
--      cannot record a gallery view at `/about`, and cannot invent a path for
--      a page that has one;
--   7. the shapes: a device that is one of three words, a referrer that is a
--      bare host, a visitor hash that is a hash, and — when one is given at
--      all — a session id that is exactly 16 random bytes as lower-case hex.
--      A NULL session is accepted, for the reason in the header: a browser
--      that will not keep a per-tab value is still a visitor.
--
-- It raises on any of these rather than returning quietly. A refused analytics
-- write is never allowed to break a page — `app/api/view/route.ts` catches and
-- logs — but it must be visible in the log rather than absorbed here, because
-- the only things that trip these checks are a bug and somebody trying it on.
--
-- `p_path` is checked, not accepted: see 6. The reason it is a parameter at all
-- rather than being derived and returned is that the caller has already
-- resolved the address and the two must AGREE; deriving it silently would turn
-- a mismatch — which is either a bug or an attempt — into a row.

create or replace function public.record_page_view(
  p_tenant        uuid,
  p_path          text,
  p_visitor       text,
  p_session       text,
  p_device        text,
  p_page_key      text default null,
  p_album         uuid default null,
  p_post          uuid default null,
  p_referrer_host text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_id       uuid;
begin
  -- 1. the site
  if p_tenant is null
     or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'record_page_view: no such site %', p_tenant;
  end if;

  -- 2. and whether this caller may record for it
  --
  -- `session_user` and `current_user` are written BARE, and `coalesce` below
  -- too. They are not functions: the parser resolves them as SQL constructs,
  -- there is no `pg_catalog.current_user` to call, and qualifying them fails
  -- with "missing FROM-clause entry for table pg_catalog" — measured, not
  -- assumed. Being parser constructs is also why `search_path = ''` cannot
  -- reach them, which is the property that matters here.
  if not (p_tenant = public.current_tenant_id() or public.is_platform_admin()
          or pg_catalog.current_setting('role', true) = 'service_role'
          or session_user = current_user) then
    raise exception 'record_page_view: not permitted to record for site %', p_tenant;
  end if;

  -- 3. exactly one identity
  if pg_catalog.num_nonnulls(p_page_key, p_album, p_post) <> 1 then
    raise exception
      'record_page_view: a view is of exactly one thing — a page, a gallery or '
      'a story. Given page_key=%, album=%, post=%.', p_page_key, p_album, p_post;
  end if;

  -- 4/5/6. the resource, its owner, and the address it lives at
  if p_album is not null then
    select '/trips/' || a.slug into v_expected
      from public.albums a
     where a.id = p_album and a.tenant_id = p_tenant;
    if v_expected is null then
      raise exception
        'record_page_view: gallery % does not belong to site %', p_album, p_tenant;
    end if;

  elsif p_post is not null then
    select '/journal/' || p.slug into v_expected
      from public.blog_posts p
     where p.id = p_post and p.tenant_id = p_tenant;
    if v_expected is null then
      raise exception
        'record_page_view: story % does not belong to site %', p_post, p_tenant;
    end if;

  else
    v_expected := case p_page_key
      when 'home'      then '/'
      when 'about'     then '/about'
      when 'contact'   then '/contact'
      when 'journal'   then '/journal'
      -- The editor calls it "galleries"; the public address has always been
      -- /trips and links to it are out in the world. lib/sections/pages.ts.
      when 'galleries' then '/trips'
      when 'shop'      then '/shop'
      else null
    end;

    if v_expected is null then
      -- One of the photographer's own pages. Its key and its address both
      -- live in the same stored list, so the address is read from there
      -- rather than trusted.
      select '/' || (e.value ->> 'slug') into v_expected
        from public.site_settings s,
             pg_catalog.jsonb_array_elements(
               coalesce(s.custom_pages, '[]'::jsonb)) as e
       where s.tenant_id = p_tenant
         and e.value ->> 'key' = p_page_key
       limit 1;
    end if;

    if v_expected is null then
      raise exception
        'record_page_view: site % has no page called %', p_tenant, p_page_key;
    end if;
  end if;

  if p_path is distinct from v_expected then
    raise exception
      'record_page_view: that resource lives at %, not at %', v_expected, p_path;
  end if;

  -- 7. the shapes
  if p_device is null or p_device not in ('phone', 'tablet', 'desktop') then
    raise exception 'record_page_view: device must be phone, tablet or desktop, not %',
      coalesce(p_device, 'null');
  end if;

  -- Null is allowed and means "this browser would not keep a per-tab value".
  -- Anything else must be exactly what lib/analytics/session.ts mints: 16
  -- random bytes as lower-case hex. `~` is case-sensitive, so an upper-case
  -- hex string is refused, which is deliberate — one canonical spelling or the
  -- column cannot be grouped by.
  if p_session is not null and p_session !~ '^[0-9a-f]{32}$' then
    raise exception
      'record_page_view: a session id must be 32 lower-case hex characters, or null';
  end if;

  -- A hash. Not an address, not a user-agent, not an email — see the
  -- page_views_visitor_is_a_hash constraint for what each clause rules out.
  if p_visitor is null
     or pg_catalog.length(p_visitor) not between 8 and 64
     or p_visitor ~ '[[:space:]@/:]'
     or p_visitor ~ '^[0-9.]+$' then
    raise exception 'record_page_view: visitor hash is not a hash';
  end if;

  if p_referrer_host is not null
     and not (p_referrer_host ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'
              and p_referrer_host like '%.%') then
    raise exception
      'record_page_view: referrer must be a bare host, not %', p_referrer_host;
  end if;

  insert into public.page_views
    (tenant_id, path, page_key, album_id, post_id,
     visitor_hash, session_hash, referrer_host, device)
  values
    (p_tenant, p_path, p_page_key, p_album, p_post,
     p_visitor, p_session, p_referrer_host, p_device)
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.record_page_view(uuid, text, text, text, text, text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_page_view(uuid, text, text, text, text, text, uuid, uuid, text)
  to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THE PERMISSION CHECK IN STEP 2 HAS FOUR CLAUSES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `enqueue_jobs` needed two, because its caller is a signed-in photographer
-- and `current_tenant_id()` reads their JWT. This function's caller is a
-- SERVER, acting for a visitor who has no session at all — so
-- `current_tenant_id()` is null on every legitimate call and cannot be the
-- test. The site comes from the `Host` header instead, resolved by
-- `lib/tenant.ts` before this is called, which is trusted input: a visitor
-- cannot forge the address they arrived on.
--
-- So what the check is for is the OTHER directions this function could be
-- called from, and it enumerates the only callers there can be:
--
--   · `service_role`      — the route. The whole reason the grant exists.
--   · the table owner     — migrations, verification suites, a psql prompt.
--     (`session_user = current_user` is true for the owner and false after a
--     `set role`, which is exactly the distinction wanted.)
--   · a signed-in photographer or platform admin recording for their own site
--     — nobody does this today; it is here so that an admin screen which one
--     day wants to could, without another migration, and so the rule is
--     stated in the same place as the others rather than implied by a grant.
--
-- `anon` and `authenticated` hold no EXECUTE, so for a browser this check is
-- the second lock on a door that is already bolted. Both, deliberately: S3's
-- grants were right and its first draft's assumptions about them were wrong.
-- ═══════════════════════════════════════════════════════════════════════════
