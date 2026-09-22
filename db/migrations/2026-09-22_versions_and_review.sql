-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-22 — Version history, and review links for unpublished changes
--
-- site_versions   The whole live site, kept after every Publish (plus, once,
--                 the site as it was before the first one). Same shape as the
--                 draft, so restoring a version simply makes it the draft: it
--                 is looked at in the editor, and nothing goes live until
--                 Publish. The newest 60 are kept. See lib/drafts/versions.ts.
--
-- draft_shares    Review links: a long random token that lets someone without
--                 an account view the draft, read-only, until it expires or is
--                 switched off. Only the site's own editors can see or create
--                 them; the review page reads them server-side with the
--                 service-role key, by token. See lib/drafts/review.ts.
--
-- Both carry the standard site policy and nothing for anonymous visitors.
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists site_versions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade
              default public.tenant_for_insert(),
  -- 'publish': the site right after a Publish. 'baseline': before the first.
  kind        text not null default 'publish' check (kind in ('publish', 'baseline')),
  note        text,
  -- { pages, global_styles, type_styles, page_seo, custom_pages, menu, chrome }
  snapshot    jsonb not null,
  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists site_versions_newest on site_versions (tenant_id, created_at desc);

select public.apply_tenant_policy('site_versions');
revoke all on site_versions from anon;
grant select, insert, update, delete on site_versions to authenticated;


create table if not exists draft_shares (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade
              default public.tenant_for_insert(),
  -- 32 random bytes, base64url. The link IS the credential.
  token       text not null unique,
  -- Who it is for, as the photographer typed it ("Ana"). Shown only to them.
  note        text,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists draft_shares_site on draft_shares (tenant_id, created_at desc);

select public.apply_tenant_policy('draft_shares');
revoke all on draft_shares from anon;
grant select, insert, update, delete on draft_shares to authenticated;

commit;

notify pgrst, 'reload schema';

-- ── Check ───────────────────────────────────────────────────────────────────
--   select kind, note, created_at from site_versions order by created_at desc;
--   select note, expires_at, revoked_at from draft_shares order by created_at desc;
