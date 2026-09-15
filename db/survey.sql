-- Schema survey — READ ONLY. Changes nothing.
--
-- Run this in the Supabase SQL editor and paste the whole result back.
--
-- It exists because db/README.md is right: there is no committed schema
-- snapshot, `lib/site.ts` can disagree with the real table without anything
-- failing, and the migration history only tells you what was *intended*.
-- Row level security is the one area where writing against an assumed schema
-- gets you either a lock-out or a hole that looks fixed.
--
-- Safe to run any time. It reads catalogue views only.

select * from (

  -- ── 1. Which tables carry a tenant, and which do not ──────────────────────
  select
    1 as ord,
    'table' as kind,
    t.table_name as name,
    case
      when c.column_name is null then 'NO tenant_id'
      else 'tenant_id ' || c.data_type ||
           coalesce(' default ' || split_part(c.column_default, '::', 1), ' NO DEFAULT')
    end as detail
  from information_schema.tables t
  left join information_schema.columns c
    on c.table_schema = t.table_schema
   and c.table_name = t.table_name
   and c.column_name = 'tenant_id'
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'

  union all

  -- ── 2. Whose columns decide who anybody is ────────────────────────────────
  select
    2, 'profiles/tenants column',
    table_name || '.' || column_name,
    data_type || case when is_nullable = 'YES' then ' null' else ' not null' end ||
      coalesce(' default ' || split_part(column_default, '::', 1), '')
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('profiles', 'tenants')

  union all

  -- ── 3. Row level security, on or off ──────────────────────────────────────
  -- A table with RLS enabled and no policy is deny-all and reads as empty
  -- with no error. A table with RLS off is wide open to the anon key.
  select
    3, 'rls',
    cl.relname,
    case when cl.relrowsecurity then 'enabled' else '*** DISABLED ***' end ||
    ' · ' || (
      select count(*)::text || ' policies'
      from pg_policies p
      where p.schemaname = 'public' and p.tablename = cl.relname
    )
  from pg_class cl
  join pg_namespace n on n.oid = cl.relnamespace
  where n.nspname = 'public' and cl.relkind = 'r'

  union all

  -- ── 4. Every policy, and what it actually checks ──────────────────────────
  select
    4, 'policy',
    tablename || ' :: ' || policyname,
    cmd || ' | using ' || coalesce(left(replace(qual, E'\n', ' '), 150), '—') ||
      case
        when with_check is null then ''
        else ' | check ' || left(replace(with_check, E'\n', ' '), 100)
      end
  from pg_policies
  where schemaname = 'public'

  union all

  -- ── 5. Foreign keys, so join tables can be scoped through their parent ────
  select
    5, 'fk',
    tc.table_name || '.' || kcu.column_name,
    ccu.table_name || '.' || ccu.column_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
   and kcu.table_schema = tc.table_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name
   and ccu.table_schema = tc.table_schema
  where tc.table_schema = 'public'
    and tc.constraint_type = 'FOREIGN KEY'

  union all

  -- ── 6. The tenant helpers that already exist ──────────────────────────────
  select
    6, 'function',
    p.proname,
    left(replace(pg_get_functiondef(p.oid), E'\n', ' '), 200)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app')
    and p.proname in (
      'default_tenant_id', 'current_tenant_id', 'is_super_admin',
      'tenant_id', 'requesting_tenant_id'
    )

) s
order by ord, name;

-- No row counts here on purpose: naming a table that does not exist would
-- fail the whole query at parse time, and section 1 already lists every table
-- there is. If `tenants` is missing from that list, that is the answer.

