-- 2026-09-15 — tenant scoping
--
-- RUN THIS BEFORE 2026-09-15_page_sections.sql AND 2026-09-15_templates.sql.
-- Those two call apply_tenant_policy(), which is defined here. (If you already
-- ran them, that is fine — this migration finds their tables and fixes them.)
--
-- ── What was wrong ──────────────────────────────────────────────────────────
--
-- Every owner policy in the schema said the same thing:
--
--     exists (select 1 from profiles p where p.id = auth.uid())
--
-- which asserts only that the caller has a profile — any profile. With one
-- account that reads as "is the owner signed in". With two, it reads as
-- "is ANY owner signed in", and either photographer can read and write the
-- other's galleries, clients, orders and messages. Nothing about it fails
-- loudly; it just quietly stops being isolation the moment a second person
-- has a login.
--
-- Every one of those is replaced here with: the row belongs to the caller's
-- own tenant, or the caller is a platform admin.
--
-- ── The second landmine ─────────────────────────────────────────────────────
--
-- Almost every tenant_id column defaults to default_tenant_id(), which was
--
--     select id from tenants limit 1;
--
-- No ORDER BY. With one tenant it is right by luck. With two it returns
-- whichever row Postgres feels like, so every insert that omits tenant_id
-- lands in an arbitrary site. That is fixed below by making inserts default to
-- the CALLER's tenant, falling back to the first tenant only for genuinely
-- anonymous writes (a contact message, a newsletter signup, a page view).
--
-- ── What this migration does NOT do ─────────────────────────────────────────
--
-- Four policies are left exactly as they are because the live site depends on
-- them and changing them here would break it:
--
--   clients        :: "Anyone with a token can read their client record"
--   album_clients  :: "Anyone can read album shares"
--   favorites      :: "Clients can manage their own favorites"
--   albums         :: "Shared albums are readable"
--
-- These are how a share link works without a login, and they are all
-- `using (true)` — so today anyone holding the public anon key can read every
-- client record and every share token, and write anyone's favourites. That is
-- a real hole, it is not a tenancy hole, and closing it needs a
-- security-definer function that takes a token and returns just that one
-- gallery. Deliberately a separate change with its own testing, not a rider on
-- this one. See db/README.md.
--
-- Also left alone: public read policies for published content (public albums,
-- published posts, active products). Published means public; the application
-- filters those by tenant when it queries them.

begin;

-- ── 1. Who the caller is ─────────────────────────────────────────────────────
--
-- The platform-admin flag has to exist before the functions below, because a
-- `language sql` function body is parsed when it is created, not when it is
-- first called — defining is_platform_admin() against a column added later
-- fails immediately.
--
-- profiles.role already exists but defaults to 'editor' and is per-tenant.
-- Working across every site is a different thing, so it gets its own column
-- rather than an overloaded role string.

alter table profiles
  add column if not exists is_platform_admin boolean not null default false;

-- Backfill so this migration cannot lock anybody out of their own admin:
-- anyone already marked owner, plus the oldest account, which on a
-- single-account install is the only one there is.
update profiles
   set is_platform_admin = true
 where role = 'owner'
    or id = (select id from profiles order by created_at asc, id asc limit 1);

-- The helpers themselves.
--
-- All SECURITY DEFINER, and this is not optional: a policy on `profiles` that
-- reads `profiles` through a normal function recurses until Postgres gives up.
-- Definer rights read the table without re-entering RLS.
--
-- All STABLE, so Postgres evaluates them once per statement rather than once
-- per row — the difference between a policy that costs nothing and one that
-- shows up in every query plan.

create or replace function public.default_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  -- ORDER BY is the whole point of this redefinition. Without it "the first
  -- tenant" means "any tenant".
  select id from tenants order by created_at asc, id asc limit 1;
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from profiles where id = auth.uid();
$$;

comment on function public.current_tenant_id() is
  'The tenant of the signed-in account, or null for an anonymous visitor. '
  'The left-hand side of every owner policy.';

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from profiles where id = auth.uid()), false);
$$;

comment on function public.is_platform_admin() is
  'You, working across every site. Not a tenant role — a flag on the account.';

create or replace function public.tenant_for_insert()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  -- A signed-in photographer's own tenant. For an anonymous write — a contact
  -- message, a newsletter signup, a page view — there is no session to read,
  -- so it falls back to the first tenant. That is correct while one site is
  -- live and WILL need to resolve by domain before a second one is.
  select coalesce(public.current_tenant_id(), public.default_tenant_id());
$$;


-- ── 2. Tables that were missing a tenant ─────────────────────────────────────

-- site_settings is the per-site configuration and had no tenant at all — one
-- row, id = 1, shared by everyone. The column is added and backfilled now,
-- while there is one row to backfill. Reads still go through id = 1 until
-- domain routing lands; the point of doing it today is that the DATA is the
-- right shape, which is the part that gets expensive later.
alter table site_settings
  add column if not exists tenant_id uuid references tenants(id);

update site_settings set tenant_id = public.default_tenant_id() where tenant_id is null;

alter table site_settings alter column tenant_id set not null;

create unique index if not exists site_settings_tenant_idx on site_settings (tenant_id);

-- room_scenes had a tenant_id with no default, so rows could be written with
-- none — and a null tenant matches no policy, which would make them invisible
-- rather than insecure. Backfilled before the policies below take effect.
update room_scenes set tenant_id = public.default_tenant_id() where tenant_id is null;

alter table room_scenes alter column tenant_id set not null;


-- ── 3. Inserts land in the caller's tenant ───────────────────────────────────
--
-- Rewrites the default on every tenant_id column there is, including ones
-- added after this migration was written.

do $$
declare
  r record;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and c.column_name = 'tenant_id'
       and t.table_type = 'BASE TABLE'
  loop
    execute format(
      'alter table public.%I alter column tenant_id set default public.tenant_for_insert()',
      r.table_name
    );
  end loop;
end $$;


-- ── 4. The standard policy, defined once ─────────────────────────────────────
--
-- Every future migration that adds a tenant-owned table calls one of these two
-- instead of hand-writing a policy. That is the actual fix: the reason every
-- table had the same wrong check was that the check was copied twenty times.

create or replace function public.apply_tenant_policy(target regclass)
returns void
language plpgsql
as $$
declare
  tbl text := target::text;
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('drop policy if exists "Tenant members manage" on %s', tbl);
  execute format(
    'create policy "Tenant members manage" on %s for all '
    'using (tenant_id = public.current_tenant_id() or public.is_platform_admin()) '
    'with check (tenant_id = public.current_tenant_id() or public.is_platform_admin())',
    tbl
  );
end $$;

comment on function public.apply_tenant_policy(regclass) is
  'The owner policy for a table with its own tenant_id. Call this rather than '
  'writing the check by hand — that is how twenty tables ended up with the '
  'same wrong one.';

-- Looks up which tenant owns a parent row, WITHOUT going through that parent's
-- own policies.
--
-- The obvious way to scope a child table is a subquery against its parent. It
-- does not work here, and the failure is spectacular rather than subtle:
-- `albums` has a policy that reads `album_clients` (that is how a share link
-- works), so a policy on `album_clients` that reads `albums` makes the two
-- policies call each other until Postgres gives up with "infinite recursion
-- detected". Every read of albums, photos or the share table dies with it.
--
-- Definer rights read the parent's tenant_id directly. Only the tenant is ever
-- read and only ever compared, so nothing about the parent row escapes.
create or replace function public.tenant_of(
  parent regclass,
  key_value uuid,
  key_column text default 'id'
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found uuid;
begin
  if key_value is null then
    return null;
  end if;

  execute format('select tenant_id from %s where %I = $1', parent::text, key_column)
     into found
    using key_value;

  return found;
end $$;

comment on function public.tenant_of(regclass, uuid, text) is
  'The tenant owning a parent row, read past RLS. Exists so a child table can '
  'be scoped through its parent without the two policies recursing.';

create or replace function public.apply_tenant_policy_via(
  target regclass,
  fk_column text,
  parent regclass,
  parent_key text default 'id'
)
returns void
language plpgsql
as $$
declare
  tbl text := target::text;
  check_expr text := format(
    '(public.tenant_of(%L::regclass, %I, %L) = public.current_tenant_id() '
    ' or public.is_platform_admin())',
    parent::text, fk_column, parent_key
  );
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('drop policy if exists "Tenant members manage" on %s', tbl);
  execute format(
    'create policy "Tenant members manage" on %s for all using %s with check %s',
    tbl, check_expr, check_expr
  );
end $$;

comment on function public.apply_tenant_policy_via(regclass, text, regclass, text) is
  'For a join or child table with no tenant of its own — scoped through its '
  'parent, so the two can never disagree.';


-- ── 5. Out with the old ──────────────────────────────────────────────────────
--
-- Named explicitly rather than matched by pattern, because a policy that is
-- merely left behind still grants access: Postgres ORs them together, so one
-- forgotten permissive policy makes the whole rewrite decorative.

drop policy if exists "Owners and editors manage album shares" on album_clients;
drop policy if exists "Owners and editors manage albums"       on albums;
drop policy if exists "Owners and editors manage blog posts"   on blog_posts;
drop policy if exists "Owners manage catalog items"            on catalog_items;
drop policy if exists "Owners and editors manage clients"      on clients;
drop policy if exists "Owners read messages"                   on contact_messages;
drop policy if exists "Owners update messages"                 on contact_messages;
drop policy if exists "Owners and editors view downloads"      on downloads;
drop policy if exists "Owners and editors view favorites"      on favorites;
drop policy if exists "Owners manage instagram media"          on instagram_media;
drop policy if exists "Owners read signups"                    on newsletter_signups;
drop policy if exists "Owners read order items"                on order_items;
drop policy if exists "Owners update order items"              on order_items;
drop policy if exists "Owners read orders"                     on orders;
drop policy if exists "Owners update orders"                   on orders;
drop policy if exists "Owners can read views"                  on page_views;
drop policy if exists "Owners manage photo categories"         on photo_shop_categories;
drop policy if exists "Owners and editors manage photos"       on photos;
drop policy if exists "Owners manage print options"            on print_options;
drop policy if exists "Owners manage products"                 on products;
drop policy if exists "Owners manage shop categories"          on shop_categories;
drop policy if exists "Owners update site settings"            on site_settings;

-- room_scenes was worse than the rest: "admin read" was `using (true)` and
-- "admin write" was `using (true) with check (true)` — for ALL commands. Any
-- holder of the public anon key could rewrite the room mockups. Both go.
drop policy if exists "room_scenes admin read"  on room_scenes;
drop policy if exists "room_scenes admin write" on room_scenes;


-- ── 6. In with the scoped ────────────────────────────────────────────────────

select public.apply_tenant_policy('albums');
select public.apply_tenant_policy('blog_posts');
select public.apply_tenant_policy('catalog_items');
select public.apply_tenant_policy('clients');
select public.apply_tenant_policy('contact_messages');
select public.apply_tenant_policy('instagram_media');
select public.apply_tenant_policy('newsletter_signups');
select public.apply_tenant_policy('order_items');
select public.apply_tenant_policy('orders');
select public.apply_tenant_policy('photos');
select public.apply_tenant_policy('print_options');
select public.apply_tenant_policy('products');
select public.apply_tenant_policy('room_scenes');
select public.apply_tenant_policy('shop_categories');
select public.apply_tenant_policy('site_settings');

-- Child tables, scoped through whichever parent actually owns them.
select public.apply_tenant_policy_via('album_clients',         'album_id', 'albums');
select public.apply_tenant_policy_via('downloads',             'photo_id', 'photos');
select public.apply_tenant_policy_via('favorites',             'album_id', 'albums');
select public.apply_tenant_policy_via('photo_shop_categories', 'photo_id', 'photos');

-- page_views hangs off EITHER an album or a story, one of the two being null
-- on any given row. The generic helper only knows one parent, and scoping this
-- through albums alone would have hidden every story's view count from its own
-- author — a bug that looks exactly like "the stats page is broken".
alter table page_views enable row level security;
drop policy if exists "Tenant members manage" on page_views;
create policy "Tenant members manage" on page_views
  for all
  using (
    public.tenant_of('albums'::regclass, album_id) = public.current_tenant_id()
    or public.tenant_of('blog_posts'::regclass, post_id) = public.current_tenant_id()
    or public.is_platform_admin()
  )
  with check (
    public.tenant_of('albums'::regclass, album_id) = public.current_tenant_id()
    or public.tenant_of('blog_posts'::regclass, post_id) = public.current_tenant_id()
    or public.is_platform_admin()
  );

-- The editor's own tables, if their migrations have already been run. Guarded
-- so this migration can go first, which is the recommended order.
do $$
begin
  if to_regclass('public.page_sections') is not null then
    drop policy if exists "Owners manage page sections" on page_sections;
    perform public.apply_tenant_policy('page_sections');
  end if;

  if to_regclass('public.templates') is not null then
    drop policy if exists "Owners manage templates" on templates;
    -- A look is shared across the platform, not owned by one site: everyone
    -- reads the published ones. Only a platform admin writes, until
    -- photographer-authored looks exist — at which point this becomes
    -- author_tenant_id = current_tenant_id() or is_platform_admin().
    drop policy if exists "Platform admins manage templates" on templates;
    create policy "Platform admins manage templates" on templates
      for all
      using (public.is_platform_admin())
      with check (public.is_platform_admin());
  end if;

  if to_regclass('public.template_versions') is not null then
    drop policy if exists "Owners read template versions" on template_versions;
    drop policy if exists "Platform admins manage template versions" on template_versions;
    create policy "Platform admins manage template versions" on template_versions
      for all
      using (public.is_platform_admin())
      with check (public.is_platform_admin());
    -- A site needs to read the archived manifest of the version it is on, and
    -- of the one being offered to it.
    drop policy if exists "Anyone reads template versions" on template_versions;
    create policy "Anyone reads template versions" on template_versions
      for select using (true);
  end if;

  if to_regclass('public.site_template') is not null then
    drop policy if exists "Owners manage site template" on site_template;
    perform public.apply_tenant_policy('site_template');
  end if;

  if to_regclass('public.site_template_history') is not null then
    drop policy if exists "Owners read template history" on site_template_history;
    perform public.apply_tenant_policy('site_template_history');
  end if;
end $$;


-- ── 7. profiles and tenants ──────────────────────────────────────────────────
--
-- profiles cannot use the generic policy: an account must always be able to
-- read itself, or signing in cannot resolve who you are.

drop policy if exists "Users can view their own profile" on profiles;
drop policy if exists "Tenant members read profiles"     on profiles;

create policy "Tenant members read profiles" on profiles
  for select
  using (
    id = auth.uid()
    or tenant_id = public.current_tenant_id()
    or public.is_platform_admin()
  );

drop policy if exists "Platform admins manage profiles" on profiles;
create policy "Platform admins manage profiles" on profiles
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- tenants stays world-readable: resolving a site by its domain happens before
-- anyone has signed in. Writing one is a platform-admin act.
drop policy if exists "Platform admins manage tenants" on tenants;
create policy "Platform admins manage tenants" on tenants
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());


-- ── 8. Nothing left behind ───────────────────────────────────────────────────
--
-- The safety net for the explicit list in section 5. If any policy anywhere
-- still carries the old "has a profile" check, this migration has not done its
-- job and should stop rather than report success.

do $$
declare
  leftovers text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
    into leftovers
    from pg_policies
   where schemaname = 'public'
     and (
       coalesce(qual, '')       like '%FROM profiles p%auth.uid()%'
       or coalesce(with_check, '') like '%FROM profiles p%auth.uid()%'
     );

  if leftovers is not null then
    raise exception
      'Un-scoped owner policies are still present: %. Nothing has been committed.',
      leftovers;
  end if;
end $$;

commit;


-- ── Verify ───────────────────────────────────────────────────────────────────
--
-- 1. You are still a platform admin, and every table is scoped:
--
--   select email, role, is_platform_admin, tenant_id from profiles;
--
--   select tablename, policyname,
--          left(replace(qual, E'\n', ' '), 90) as using_check
--     from pg_policies
--    where schemaname = 'public' and policyname like 'Tenant members%'
--    order by tablename;
--
-- 2. Nothing is orphaned:
--
--   select 'site_settings' as t, count(*) filter (where tenant_id is null) as null_tenants
--     from site_settings
--   union all select 'room_scenes', count(*) filter (where tenant_id is null) from room_scenes;
--
--   Expect 0 and 0.
--
-- 3. Then prove the isolation actually holds — db/verify-tenant-isolation.sql
--    builds a second tenant, checks both directions, and rolls back.
--
-- 4. Reload PostgREST:
--
--   notify pgrst, 'reload schema';
