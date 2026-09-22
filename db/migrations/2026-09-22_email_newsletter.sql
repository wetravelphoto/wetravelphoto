-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-22 — Contact messages by email, and newsletter connections
--
-- Contact form:
--   site_settings.contact_notify        email each new message (default on)
--   site_settings.contact_notify_email  where to (empty: the public email)
--   contact_messages.notified_at        when it was emailed
--   contact_messages.notify_error       or why it was not
--   The email itself is sent by the platform (lib/email.ts), so there is
--   nothing for a photographer to set up but the address.
--
-- Newsletter:
--   site_secrets.newsletter_provider / _key / _list_id / _list_name /
--   _double_optin   the photographer's own mailing service (Mailchimp, Kit,
--                   MailerLite, Brevo, Flodesk). The key sits next to the
--                   Instagram token: only this site's editors can read it,
--                   never a visitor.
--   newsletter_signups.synced_at / sync_error   whether each sign-up has
--                   been sent on to that service. Every sign-up is still kept
--                   here, whatever happens to the connection.
--
-- No policy changes: every table already carries its own. Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table site_settings    add column if not exists contact_notify        boolean not null default true;
alter table site_settings    add column if not exists contact_notify_email  text;

alter table contact_messages add column if not exists notified_at   timestamptz;
alter table contact_messages add column if not exists notify_error  text;

alter table site_secrets     add column if not exists newsletter_provider     text;
alter table site_secrets     add column if not exists newsletter_key          text;
alter table site_secrets     add column if not exists newsletter_list_id      text;
alter table site_secrets     add column if not exists newsletter_list_name    text;
alter table site_secrets     add column if not exists newsletter_double_optin boolean not null default false;

alter table newsletter_signups add column if not exists synced_at   timestamptz;
alter table newsletter_signups add column if not exists sync_error  text;

commit;

notify pgrst, 'reload schema';

-- ── Check ───────────────────────────────────────────────────────────────────
--   select contact_notify, contact_notify_email from site_settings;
--   select newsletter_provider, newsletter_list_name from site_secrets;
