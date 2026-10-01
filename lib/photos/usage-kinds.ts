/**
 * WHERE A PHOTOGRAPH CAN BE PLACED
 * ════════════════════════════════
 *
 * The vocabulary of `photo_usages`, declared once for the application. The
 * table, its CHECKs and its per-kind unique indexes are in
 * `db/migrations/2026-09-29_photo_assets.sql`, and the eighth kind,
 * `page_share`, in `db/migrations/2026-09-30_photo_usages_sync.sql` (P3); the
 * design is `claude/photo-assets-design.md` §2 and §4.
 *
 * P1 declared this; P3's projection (lib/photos/usages.ts) reads it. `.mk/photo-assets.ts` holds it
 * to the database: every kind here is a kind the CHECK accepts and vice versa,
 * each kind's parent column is the one `photo_usages_one_parent` demands, and
 * the draft-capable kinds are the ones `photo_usages_scope_by_kind` allows.
 * Two copies of one list drift; that suite is what notices.
 *
 * `photo_usages` is a READ-ONLY PROJECTION, written by syncUsages() (P3) and by
 * nothing else — except `gallery`, which is ALSO created beside its `photos`
 * row (P2) and removed with it by cascade; syncUsages recreates the same row.
 *
 * `live` means the saved, canonical state of the parent — for a story that is
 * every saved `blog_posts` row, published or not. It is not "what a visitor
 * can see".
 */

export const USAGE_KINDS = [
  'gallery',
  'gallery_cover',
  'page_section',
  'page_legacy',
  'page_share',
  'story_cover',
  'story_block',
  'shop_listing',
] as const

export type UsageKind = (typeof USAGE_KINDS)[number]

export const USAGE_SCOPES = ['live', 'draft'] as const

export type UsageScope = (typeof USAGE_SCOPES)[number]

/**
 * The one parent column each kind sets; the other four stay null. `page_key`
 * has no parent row — see the design §3.4 — and is checked by shape instead.
 */
export const USAGE_PARENT = {
  gallery: 'photo_id',
  gallery_cover: 'album_id',
  page_section: 'page_key',
  page_legacy: 'page_key',
  page_share: 'page_key',
  story_cover: 'post_id',
  story_block: 'post_id',
  shop_listing: 'product_id',
} as const satisfies Record<UsageKind, string>

export type UsageParentColumn = (typeof USAGE_PARENT)[UsageKind]

/** Only pages have a draft layer, so only page kinds may be draft-scoped. */
export const DRAFT_KINDS = ['page_section', 'page_legacy', 'page_share'] as const satisfies readonly UsageKind[]
