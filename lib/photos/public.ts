import 'server-only'
import { cache } from 'react'
import type { Metadata } from 'next'
import { currentSite } from '@/lib/tenant'
import { requireEditor } from '@/lib/auth'
import { createAdminClientOrNull } from '@/lib/supabase/admin'
import { RenderAssetReader, type HostTenant, type RenderRpc, type SourceGrant, type SourceKind } from '@/lib/photos/render-reader'
import type { RenderRef } from '@/lib/photos/image'
import {
  NO_OUTCOMES,
  coverView,
  featuredCardView,
  fileFor,
  galleryPhotoView,
  memberPicture,
  memberRef,
  outcomesOf,
  pictureView,
  postImageView,
  relationalPicture,
  relationalPictureRef,
  blockRef,
  sectionPicture,
  sectionRefs,
  type CoverView,
  type Fit,
  type GalleryPhotoView,
  type GalleryRow,
  type ImageView,
  type Picture,
  type PostBlock,
  type PostImageView,
  type RenderOutcomes,
} from '@/lib/photos/render-view'
import { photoRole } from '@/lib/sections/image-bundle'
import { photoUrl } from '@/lib/images'
import { srcSetFor, displayUrl, srcSetFromPath } from '@/lib/srcset'
import { loadPageSections, type PageSections } from '@/lib/sections/load'
import { composeDraftPage, loadDraftPage } from '@/lib/drafts/store'
import { openShare } from '@/lib/drafts/review'
import { findPage, sanitizeCustomPages, type CustomPage } from '@/lib/sections/pages'
import { getSiteSettings } from '@/lib/site'
import { firstPhotoSlot, pageMetadata, readPageSeo, resolveSeo } from '@/lib/seo'
import { openAlbum, photosForAlbum, type PublicAlbum } from '@/lib/album-access'
import { accessForToken, albumsForAccess, favoritePhotoIds, photosForAccess, type ShareAccess } from '@/lib/gallery-access'
import { PUBLIC_ALBUM_COLUMNS, coverSources, publicAlbumRows, type CoverRow } from '@/lib/album-covers'
import { publishedStoryBySlug, publishedStoryRows, relatedStoryRows, type StoryCardRow } from '@/lib/stories'
import {
  displayTitle,
  getPublishedCatalogResult,
  getPublishedEntry,
  getRelated,
  type CatalogEntry,
} from '@/lib/catalog'
import { blockImages, type Block } from '@/lib/blocks'

/**
 * SERVER-ONLY ENTRY TO CANONICAL PHOTOGRAPH METADATA
 * ══════════════════════════════════════════════════
 *
 * P5. The only module that may mint a `HostTenant` or a `SourceGrant`
 * (.mk/render-read.ts fails on a cast anywhere else). It never reads
 * photo_assets itself — it cannot: the service role holds no privilege on it.
 * Everything goes through read_photo_render_assets, for named references.
 *
 * Not a server action and never exported to the browser: there is no
 * "read these assets" endpoint a visitor can call with a list of ids.
 *
 * ── One door per source ─────────────────────────────────────────────────────
 * Every export below is ONE surface. Each loads its own source through that
 * source's existing gate — the live page's sections, an album past
 * openAlbum(), a share link past accessForToken(), a published story, the
 * published catalogue, the editor's draft behind requireEditor(), a review
 * link behind openShare() — and only THEN collects references, from the rows
 * it loaded itself, and asks. Nothing exported takes a reference, an asset id,
 * a tenant or a "this is allowed" flag from a caller: a grant is minted inside
 * this file, after the gate, and never leaves it (`ask`).
 *
 * ── One reader per request ──────────────────────────────────────────────────
 * `renderReader()` is React's per-request `cache()`: the page, its metadata
 * and every source on it share one reader, one memo and one budget
 * (READER_MAX_CALLS calls of up to 200 references). Nothing is kept between
 * requests, so a description written a moment ago is what the next one reads.
 *
 * What the browser is handed is a view (lib/photos/render-view.ts): a URL, a
 * srcset, alt text. Never a row, an asset id, a key base or a derivative map.
 */

/** The request's site, from its Host. Null when the address is no site's. */
export const hostTenant = cache(async (): Promise<HostTenant | null> => {
  const site = await currentSite()
  return site ? ({ tenantId: site.tenantId } as HostTenant) : null
})

/**
 * This request's call budget. A page asks once per source it draws (its
 * sections, its galleries' covers, its stories, its prints) and once for its
 * share image, so the default of five is too tight for a homepage; eight
 * calls is 1600 distinct photographs a request.
 */
export const READER_MAX_CALLS = 8

/**
 * This request's reader — one per request (`cache()` is per request on the
 * server), so what one visitor was told is never another's answer. Null when
 * there is no site here or the service key is missing: then nothing is
 * verified, so a placement that names an identity draws nothing and an
 * unidentified one renders its stored path, exactly as before P5.
 */
export const renderReader = cache(async (): Promise<RenderAssetReader | null> => {
  const tenant = await hostTenant()
  if (!tenant) return null
  const admin = createAdminClientOrNull()
  if (!admin) return null
  return new RenderAssetReader(tenant, admin as unknown as RenderRpc, { maxCalls: READER_MAX_CALLS })
})

/**
 * Ask about references a gate has just admitted. NOT exported: the grant is
 * minted here, for the request's own site, by a caller in this file that has
 * already loaded and authorised the source the references came from.
 */
async function ask(source: SourceKind, refs: readonly (RenderRef | null)[]): Promise<RenderOutcomes> {
  const named = refs.filter((r): r is RenderRef => r !== null)
  if (named.length === 0) return NO_OUTCOMES
  const [site, reader] = await Promise.all([hostTenant(), renderReader()])
  if (!site || !reader) return NO_OUTCOMES
  const grant = { tenantId: site.tenantId, source } as unknown as SourceGrant
  return outcomesOf(named, await reader.resolve(grant, named))
}

/**
 * A source read that failed. Logged as a fixed class and nothing else — never
 * the provider's message, which can quote a path, an id or the query — and
 * nothing that came back beside the error is drawn or asked about.
 */
function sourceFailed(source: 'galleries' | 'stories' | 'story' | 'related_stories', error: unknown): void {
  console.error('[render] a source could not be read', { source, reason: error ? 'error' : 'malformed' })
}

/** What the galleries section says when the site's galleries could not be read. */
const GALLERIES_UNAVAILABLE = 'please try again in a moment.'
/** The fixed message of a story page whose story could not be read. */
const STORY_UNAVAILABLE = 'The story could not be read.'

// ════════════════════════════════════════════════════════════════════════════
// PAGES — live, the editor's preview, a review link
// ════════════════════════════════════════════════════════════════════════════

/** A page's sections with the answers its photographs were given. */
export type RenderedPage = PageSections & { images: RenderOutcomes }

/**
 * A PUBLIC page: its LIVE sections only — page_sections, or the legacy
 * adapter — scoped to the Host's site by loadPageSections. Never the draft.
 * Cached per request, so the page and its metadata read it once.
 */
export const livePage = cache(async (page: string): Promise<RenderedPage> => {
  const live = await loadPageSections(page)
  return { ...live, images: await ask('live_page', sectionRefs(live.sections)) }
})

/**
 * THE EDITOR'S PREVIEW: the draft, only for an editor of the site whose
 * address this is. requireEditor() refuses a signed-out visitor, an account
 * with no site, a viewer, and an editor of another site on a claimed address;
 * the comparison below also refuses a mismatch on an address that was only
 * assumed (a laptop, a preview build). Null → the route shows nothing.
 */
export async function previewPage(page: string): Promise<(RenderedPage & { isDraft: boolean }) | null> {
  const editor = await requireEditor().catch(() => null)
  const site = await currentSite()
  if (!editor || !site || editor.tenantId !== site.tenantId) return null
  const draft = await loadDraftPage(page)
  return { ...draft, images: await ask('page_preview', sectionRefs(draft.sections)) }
}

export type ReviewedPage =
  | { status: 'invalid' | 'published' }
  | ({ status: 'ok'; page: string; custom: CustomPage[] } & RenderedPage)

/**
 * A REVIEW LINK: the draft its token opens, for someone without an account.
 * openShare() checks the token's shape, its expiry, that it is not revoked and
 * that it belongs to the site whose address this is; nothing is read for a
 * token that fails any of those.
 */
export async function reviewPage(token: string, asked: string | undefined): Promise<ReviewedPage> {
  const share = await openShare(token)
  if (share.status !== 'ok') return { status: share.status }
  const site = await currentSite()
  if (!site || share.tenantId !== site.tenantId) return { status: 'invalid' }

  const { draft } = share
  // The pages as the draft has them, so a new page can be reviewed before it
  // is published. An unknown page shows the homepage.
  const custom = draft.custom_pages ?? sanitizeCustomPages((await getSiteSettings()).custom_pages)
  const page = asked && findPage(asked, custom) ? asked : 'home'
  const composed = await composeDraftPage(draft, page)
  return { status: 'ok', page, custom, ...composed, images: await ask('page_preview', sectionRefs(composed.sections)) }
}

/** A Picture → the absolute URL a share image is, or null. */
function shareUrl(p: Picture): string | null {
  switch (p.kind) {
    case 'none':
      return null
    case 'legacy':
    case 'sample':
      return photoUrl(p.path)
    case 'asset':
      return photoUrl(fileFor(p, 'full'))
  }
}

/**
 * A PUBLIC page's metadata, from the same live source as the page. The share
 * image is the photograph the page would show: a share image chosen in Page
 * settings or the homepage's (a path, resolved relationally), or the first
 * photograph on the page (that very slot, resolved as the section draws it).
 */
export async function livePageMetadata(page: string): Promise<Metadata> {
  const { sections, settings, images } = await livePage(page)
  const seo = resolveSeo(page, sections, settings)
  let url: string | null = null
  if (seo.imageFrom === 'page' || seo.imageFrom === 'site') {
    const path = readPageSeo(settings, seo.imageFrom === 'page' ? page : 'home').image ?? null
    const outcomes = await ask('page_metadata', [relationalPictureRef(path)])
    url = shareUrl(relationalPicture(outcomes, path, 'decorative'))
  } else if (seo.imageFrom === 'photo') {
    // firstPhotoSlot names photographs only (never the hero's video), so the
    // slot always resolves as the section draws it — no fallback past a
    // failed identity.
    const slot = firstPhotoSlot(sections)
    if (slot) url = shareUrl(sectionPicture(images, slot.section.settings, slot.field.key, photoRole(slot.field)))
  }
  return pageMetadata(page, sections, settings, url)
}

// ════════════════════════════════════════════════════════════════════════════
// WHAT A PAGE'S SECTIONS READ BESIDE THEMSELVES — lib/sections/context.ts
// ════════════════════════════════════════════════════════════════════════════

/**
 * A public gallery as the galleries section draws it: exactly the card's
 * columns (PUBLIC_ALBUM_COLUMNS) and its resolved cover. Built field by field,
 * never by spreading a row, so nothing else a row might carry — a password
 * hash, a column added later — can ride along into a page's data.
 */
export type AlbumCard = { [K in (typeof PUBLIC_ALBUM_COLUMNS)[number]]: unknown } & { id: string } & CoverView

function albumCard(row: Record<string, unknown> & { id: string }, cover: CoverView): AlbumCard {
  const card = Object.fromEntries(PUBLIC_ALBUM_COLUMNS.map((c) => [c, row[c] ?? null])) as AlbumCard
  return { ...card, id: row.id, coverUrl: cover.coverUrl, coverSrcSet: cover.coverSrcSet }
}

type AlbumSourceRow = Record<string, unknown> & { id: string; cover_photo_id: string | null; cover_custom_path: string | null }

/**
 * The site's PUBLIC galleries, with their covers. A failed album read is an
 * error — a fixed sentence the section shows, never the provider's message —
 * and nothing is read or asked after it; a failed cover read leaves those
 * cards without a cover and says so in `coversFailed` — never a successful
 * "no cover".
 */
export async function publicAlbumCards(): Promise<{ albums: AlbumCard[]; error: string | null; coversFailed: boolean }> {
  const site = await hostTenant()
  if (!site) return { albums: [], error: null, coversFailed: false }
  const { data, error } = await publicAlbumRows(site.tenantId)
  if (error || !Array.isArray(data)) {
    sourceFailed('galleries', error)
    return { albums: [], error: GALLERIES_UNAVAILABLE, coversFailed: false }
  }
  const albums = data as unknown as AlbumSourceRow[]
  const { sources, failed } = await coverSources(site.tenantId, albums)
  const outcomes = await ask(
    'gallery',
    [...sources.values()].map((s) => (s.kind === 'custom' ? relationalPictureRef(s.path) : s.kind === 'member' ? memberRef(s.row) : null))
  )
  return {
    albums: albums.map((a) => albumCard(a, coverView(outcomes, sources.get(a.id), 'grid'))),
    error: null,
    coversFailed: failed,
  }
}

/**
 * A published story's card: its row, and its featured image as views — full
 * size for a sequence opening the page, card size for a grid.
 */
export type StoryCard = StoryCardRow & { featured: ImageView | null; featuredCard: ImageView | null }

/**
 * The site's PUBLISHED stories, newest first, for cards and sequences. A
 * failed read is `failed` — never a site with nothing published — and nothing
 * is asked about.
 */
export async function publishedStoryCards(): Promise<{ stories: StoryCard[]; failed: boolean }> {
  const site = await hostTenant()
  if (!site) return { stories: [], failed: false }
  const { data, error } = await publishedStoryRows(site.tenantId)
  if (error || !Array.isArray(data)) {
    sourceFailed('stories', error)
    return { stories: [], failed: true }
  }
  const rows = data as StoryCardRow[]
  const outcomes = await ask('story', rows.map((r) => relationalPictureRef(r.featured_custom_path)))
  return {
    stories: rows.map((r) => ({
      ...r,
      featured: featuredCardView(outcomes, r.featured_custom_path, 'full'),
      featuredCard: featuredCardView(outcomes, r.featured_custom_path, 'grid'),
    })),
    failed: false,
  }
}

/** A print with its photograph resolved. */
export type PrintEntry = CatalogEntry & { view: ImageView | null }

function printViews(outcomes: RenderOutcomes, entries: CatalogEntry[], fit: Fit): PrintEntry[] {
  return entries.map((e) => {
    const title = displayTitle(e, e.photo)
    const view = pictureView(memberPicture(outcomes, e.photo, 'content'), fit, () => ({
      src: displayUrl(e.photo),
      srcSet: srcSetFor(e.photo),
      alt: e.photo.alt_text ?? title,
    }))
    return { ...e, view }
  })
}

/** The PUBLISHED catalogue of the site (getPublishedCatalogResult's own filters). */
export async function publishedCatalog(categoryId: string | null): Promise<{ entries: PrintEntry[]; failed: boolean }> {
  const { entries, failed } = await getPublishedCatalogResult(categoryId)
  const outcomes = await ask('shop', entries.map((e) => memberRef(e.photo)))
  return { entries: printViews(outcomes, entries, 'grid'), failed }
}

/** One PUBLISHED print and its neighbours, or null when it is not for sale here. */
export async function publishedPrint(photoId: string): Promise<{ entry: PrintEntry; related: PrintEntry[] } | null> {
  const entry = await getPublishedEntry(photoId)
  if (!entry) return null
  const related = await getRelated(entry, 4)
  const outcomes = await ask('shop', [entry, ...related].map((e) => memberRef(e.photo)))
  return { entry: printViews(outcomes, [entry], 'full')[0]!, related: printViews(outcomes, related, 'grid') }
}

// ════════════════════════════════════════════════════════════════════════════
// A GALLERY BY ITS ADDRESS, AND BY A SHARE LINK
// ════════════════════════════════════════════════════════════════════════════

const publicUrl = () => process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

/** A gallery photograph's row, as album-access and gallery-access select it. */
type PhotoRow = CoverRow & GalleryRow

export type OpenedGallery =
  | { status: 'missing' }
  | { status: 'locked'; album: PublicAlbum }
  | { status: 'open'; album: PublicAlbum; photos: GalleryPhotoView[]; cover: CoverView }

/**
 * /trips/<slug>: openAlbum() is the page's own gate (client-only refused,
 * password needing its cookie, unlisted open by its address). Only an `open`
 * album's photographs are read, and only they and its cover are asked about.
 */
export async function openGallery(slug: string): Promise<OpenedGallery> {
  const gate = await openAlbum(slug)
  if (gate.status !== 'open') return gate
  const { album } = gate
  const site = await hostTenant()
  if (!site) return { status: 'missing' }

  const orderColumn = album.sort_order === 'manual' ? 'sort_order' : 'taken_at'
  const ascending = album.sort_order !== 'date_desc'
  const rows = (await photosForAlbum(album.id, orderColumn, ascending, album.privacy_type === 'public')) as unknown as PhotoRow[]
  // Answered from the rows just read behind the gate: no further read can fail.
  const { sources: covers } = await coverSources(site.tenantId, [album as { id: string; cover_photo_id: string | null; cover_custom_path: string | null }], rows)
  const cover = covers.get(album.id)
  const outcomes = await ask('gallery', [
    ...rows.map((r) => memberRef(r)),
    cover?.kind === 'custom' ? relationalPictureRef(cover.path) : null,
  ])
  const url = publicUrl()
  return {
    status: 'open',
    album,
    photos: rows.map((r) => galleryPhotoView(outcomes, r, url)).filter((p): p is GalleryPhotoView => p !== null),
    // The cover is the largest thing on the page.
    cover: coverView(outcomes, cover, 'full'),
  }
}

export type SharedAlbum = {
  album: Record<string, unknown> & { id: string }
  cover: ImageView | null
  photos: GalleryPhotoView[]
}

/**
 * /gallery/<token>: accessForToken() checks the token against THIS site's
 * clients and lists the albums it opens; nothing else is read for a token
 * that fails. The albums and photographs come from those ids only.
 */
export async function openSharedGallery(
  token: string
): Promise<{ access: ShareAccess; albums: SharedAlbum[]; favoriteIds: string[] } | null> {
  const access = await accessForToken(token)
  if (!access) return null
  const [albums, rows, favoriteIds] = await Promise.all([albumsForAccess(access), photosForAccess(access), favoritePhotoIds(access)])
  const photoRows = rows as unknown as PhotoRow[]
  type SharedRow = Record<string, unknown> & { id: string; cover_photo_id: string | null; cover_custom_path?: string | null }
  const albumRows = albums as unknown as SharedRow[]

  // Each album's cover source, answered from the rows just read behind the
  // token (no further read). Since client-gallery-v2 a custom cover counts
  // here too — the share page opens on the album's cover.
  const sources = await Promise.all(
    albumRows.map(async (album) => {
      const own = photoRows.filter((p) => p.album_id === album.id)
      const { sources: covers } = await coverSources(
        access.tenantId,
        [{ id: album.id, cover_photo_id: album.cover_photo_id, cover_custom_path: album.cover_custom_path ?? null }],
        own
      )
      return { album, own, source: covers.get(album.id) }
    })
  )

  const outcomes = await ask('gallery_share', [
    ...photoRows.map((r) => memberRef(r)),
    ...sources.map(({ source }) => (source?.kind === 'custom' ? relationalPictureRef(source.path) : null)),
  ])
  const url = publicUrl()

  const shared = sources.map(({ album, own, source }) => {
    // A member cover is drawn from the photograph's stored file, as the share
    // page always has; a custom one with the ladder derived from its path.
    const cover =
      source?.kind === 'member'
        ? pictureView(memberPicture(outcomes, source.row, 'decorative'), 'full', (path) => ({ src: photoUrl(path), alt: '' }))
        : source?.kind === 'custom'
          ? pictureView(relationalPicture(outcomes, source.path, 'decorative'), 'full', (path) => {
              const src = photoUrl(path)
              return { src, srcSet: srcSetFromPath(src), alt: '' }
            })
          : null
    return {
      album,
      cover,
      photos: own.map((r) => galleryPhotoView(outcomes, r, url)).filter((p): p is GalleryPhotoView => p !== null),
    }
  })
  return { access, albums: shared, favoriteIds }
}

// ════════════════════════════════════════════════════════════════════════════
// A PUBLISHED STORY
// ════════════════════════════════════════════════════════════════════════════

type StoryRow = Record<string, unknown> & { id: string; tenant_id: string; featured_custom_path: string | null; blocks: unknown }

export type PublishedStory = {
  post: StoryRow
  /** The blocks for PostBody, every image reduced to its caption and view. */
  blocks: PostBlock[]
  featured: ImageView | null
  related: Array<{ id: string; slug: string; title: string; category: string | null; image: ImageView | null }>
  /** "Keep reading" could not be read: the row is left out, not shown empty-handed as "nothing else". */
  relatedFailed: boolean
}

/** Every image object of a story's blocks → its PostBody view, in place. */
function viewBlocks(outcomes: RenderOutcomes, blocks: Block[], url: string): PostBlock[] {
  const one = (image: unknown): PostImageView =>
    postImageView(outcomes, (image ?? {}) as Parameters<typeof postImageView>[1], url)
  return blocks.map((b): PostBlock => {
    switch (b.type) {
      case 'image':
        return { ...b, image: one(b.image) }
      case 'image_pair':
        return { ...b, left: one(b.left), right: one(b.right) }
      case 'gallery':
      case 'masonry':
        return { ...b, images: (b.images ?? []).map(one) }
      default:
        return b
    }
  })
}

/**
 * /journal/<slug>: a PUBLISHED story of this site (publishedStoryBySlug's own
 * filters), or null. Its references — the featured image, every block image,
 * the "keep reading" covers — come from that row and those published rows.
 *
 * A failed read of the story THROWS, with a fixed message: a page that could
 * not be read is an error, never "not found" (which a cache would keep). A
 * failed read of "keep reading" leaves that row out and says so in
 * `relatedFailed`; the story itself still renders.
 */
export const publishedStory = cache(async (slug: string): Promise<PublishedStory | null> => {
  const site = await hostTenant()
  if (!site) return null
  const found = await publishedStoryBySlug(site.tenantId, slug)
  if (found.error) {
    sourceFailed('story', found.error)
    throw new Error(STORY_UNAVAILABLE)
  }
  const post = found.data as StoryRow | null
  if (!post) return null
  const others = await relatedStoryRows(site.tenantId, post.id)
  const relatedFailed = !!others.error || !Array.isArray(others.data)
  if (relatedFailed) sourceFailed('related_stories', others.error)
  const related = relatedFailed ? [] : (others.data as Array<StoryCardRow>)
  const blocks = (Array.isArray(post.blocks) ? post.blocks : []) as Block[]

  const outcomes = await ask('story', [
    relationalPictureRef(post.featured_custom_path),
    ...blockImages(blocks).map((i) => (i && typeof i === 'object' ? blockRef(i as Parameters<typeof blockRef>[0]) : null)),
    ...related.map((r) => relationalPictureRef(r.featured_custom_path)),
  ])

  return {
    post,
    blocks: viewBlocks(outcomes, blocks, publicUrl()),
    // The story's own photograph: content, so its canonical description is used.
    featured: pictureView(relationalPicture(outcomes, post.featured_custom_path, 'content'), 'full', (path) => ({
      src: photoUrl(path),
      alt: '',
    })),
    related: related.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: r.category,
      image: pictureView(relationalPicture(outcomes, r.featured_custom_path, 'decorative'), 'grid', (path) => ({
        src: photoUrl(path),
        alt: '',
      })),
    })),
    relatedFailed,
  }
})

/** The share image of a published story: its featured photograph, resolved. */
export async function publishedStoryImage(slug: string): Promise<string | null> {
  const story = await publishedStory(slug)
  return story?.featured?.src ?? null
}
