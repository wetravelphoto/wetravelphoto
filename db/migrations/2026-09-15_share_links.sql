-- 2026-09-15 — close the share-link hole
--
-- RUN AFTER 2026-09-15_tenant_scoping.sql.
-- DEPLOY THE MATCHING CODE FIRST, or client galleries stop working — see below.
--
-- ── What was open ───────────────────────────────────────────────────────────
--
-- Five policies were `using (true)`, which does not mean "anyone with a share
-- link". It means anyone at all. The anon key is published in the browser
-- bundle of every page on the site, so "anyone at all" is literal: paste that
-- key into curl and PostgREST answers.
--
--   clients        :: Anyone with a token can read their client record
--                     → every client row, every name, every email address,
--                       and every access_token, in one request
--   album_clients  :: Anyone can read album shares
--                     → every share, so the tokens above map to galleries
--   favorites      :: Clients can manage their own favorites
--                     → read, insert and DELETE anyone's favourites
--   albums         :: Shared albums are readable
--                     → any album with a share row, including password_hash
--   photos         :: Photos in shared albums are readable
--                     → and therefore every photograph in it
--
-- Taken together those are not five small holes, they are one large one: read
-- the tokens, read the shares, and every private client gallery on the site
-- opens. No login, no guessing.
--
-- ── Why policies cannot fix this ────────────────────────────────────────────
--
-- The honest policy would be "readable when the caller holds a valid share
-- token", but a policy cannot see the token: it arrives as part of a Next.js
-- request, not as a database session. Postgres has no idea the visitor typed
-- one.
--
-- So authorization moves up into the server, where the token actually is, and
-- these tables stop answering to anon entirely. lib/gallery-access.ts is the
-- only thing that reads them for a visitor, it verifies the token first, and
-- every query it offers is scoped to what that token opened. One file, and
-- nothing outside it can forget the check.
--
-- ── Order matters ───────────────────────────────────────────────────────────
--
-- The moment this runs, a client gallery served by the OLD code returns "not
-- found": it reads clients with the anon key, which is exactly what stops
-- working. Deploy first, then run this. Nothing is destroyed either way — the
-- policies can be recreated from this file's history — but a share link in
-- someone's inbox will be dead in between.

begin;

-- ── The five ─────────────────────────────────────────────────────────────────

drop policy if exists "Anyone with a token can read their client record" on clients;
drop policy if exists "Anyone can read album shares"                     on album_clients;
drop policy if exists "Clients can manage their own favorites"           on favorites;
drop policy if exists "Shared albums are readable"                       on albums;
drop policy if exists "Photos in shared albums are readable"             on photos;

-- Anonymous download logging goes with them: the download routes now write
-- through the server after checking the token, so nothing needs to be able to
-- post arbitrary rows here.
drop policy if exists "Downloads can be logged" on downloads;

-- ── What deliberately stays open ─────────────────────────────────────────────
--
--   albums  :: Public can view public albums          — published means public
--   photos  :: Public can view photos in public albums  — same
--   page_views :: Anyone can record a view            — a counter, not data
--   contact_messages :: Anyone can send a message     — insert only, no read
--   newsletter_signups :: Anyone can sign up          — insert only, no read
--
-- Each is insert-only or covers content that is already on the open web.

-- The token lookup is now the front door for every private gallery, so it
-- should not be a sequential scan.
create index if not exists clients_access_token_idx on clients (access_token);


-- ── Nothing left behind ──────────────────────────────────────────────────────

do $$
declare
  leftovers text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
    into leftovers
    from pg_policies
   where schemaname = 'public'
     and tablename in ('clients', 'album_clients', 'favorites')
     and cmd in ('ALL', 'SELECT')
     and coalesce(qual, '') in ('true', '(true)');

  if leftovers is not null then
    raise exception
      'These still read as world-readable: %. Nothing has been committed.', leftovers;
  end if;
end $$;

commit;


-- ── Verify ───────────────────────────────────────────────────────────────────
--
-- 1. Nothing on these tables answers to a passer-by any more:
--
--   select tablename, policyname, cmd, coalesce(qual, '—') as using_check
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('clients','album_clients','favorites','albums','photos','downloads')
--    order by tablename, policyname;
--
--   Expect, for each of clients / album_clients / favorites / downloads, only
--   "Tenant members manage". albums and photos keep their two public-content
--   policies and nothing else.
--
-- 2. Prove it from the outside — db/verify-tenant-isolation.sql now checks
--    that an anonymous caller reads zero clients, zero shares and zero
--    favourites. That check used to be marked "(known)" and expected to fail.
--    It should now pass.
--
-- 3. Reload PostgREST:
--
--   notify pgrst, 'reload schema';
--
-- 4. Then open a real share link and star a photograph. If the gallery says
--    "not found", the code deploy has not landed yet — see the note at the top.
