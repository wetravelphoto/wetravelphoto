-- ════════════════════════════════════════════════════════════════════════════
-- site_secrets: credentials move out of the publicly readable settings row.
--
-- site_settings has to be readable with the public (anon) key: the site needs
-- its colours, fonts and copy before anybody signs in. But the Instagram
-- long-lived access token lived in that same row, so anyone holding the public
-- key — it is in every page's JavaScript — could ask PostgREST for it.
--
-- This table holds such credentials instead. It carries the standard site
-- policy (only the site's own signed-in editors, or a platform admin, can
-- read or write its row) and nothing for anonymous visitors. The scheduled
-- Instagram job reads it with the service-role key.
--
-- NOTHING IS DROPPED. The token is copied here, then blanked in site_settings;
-- the column stays (and so does instagram_token_expires, which is not secret
-- and which the settings screen shows).
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists site_secrets (
  tenant_id        uuid primary key references tenants(id) on delete cascade
                   default public.tenant_for_insert(),
  instagram_token  text,
  updated_at       timestamptz not null default now()
);

comment on table site_secrets is
  'Per-site credentials. Never readable by anonymous visitors — unlike site_settings.';

-- Standard site policy: enables row-level security, and lets only this site's
-- editors (or a platform admin) see or change its row.
select public.apply_tenant_policy('site_secrets');

-- Belt and braces: no anonymous access at the privilege level either.
revoke all on site_secrets from anon;
grant select, insert, update, delete on site_secrets to authenticated;

-- Carry the existing token across…
insert into site_secrets (tenant_id, instagram_token)
select tenant_id, instagram_token
  from site_settings
 where instagram_token is not null
on conflict (tenant_id) do update
   set instagram_token = excluded.instagram_token,
       updated_at      = now();

-- …and stop publishing it.
update site_settings set instagram_token = null where instagram_token is not null;

commit;

notify pgrst, 'reload schema';

-- Check (as the SQL editor, which bypasses RLS):
--   select tenant_id, instagram_token is not null as has_token from site_secrets;
--   select count(*) from site_settings where instagram_token is not null;  -- expect 0
