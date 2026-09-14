import { getPublishedCatalog } from '@/lib/catalog'
import { getSiteSettings } from '@/lib/site'
import { setShopRoom } from '@/app/actions/scenes'
import { PRESET_ROOMS, roomFor, imageFor } from '@/lib/preset-rooms'
import { displayUrl, srcSetFor } from '@/lib/srcset'
import RoomScene from '@/components/shop/RoomScene'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

/**
 * One choice: which room prints hang in on a product page.
 *
 * Three rooms, shipped with the site, already marked up and light-matched.
 * No uploading, no marking corners, no per-print setup — the previous version
 * of this screen had all three and was more to understand than it was worth.
 */
export default async function RoomPage() {
  const [catalog, settings] = await Promise.all([getPublishedCatalog(), getSiteSettings()])

  const chosen = settings.shop_room ?? 'living-room'
  const sample = catalog[0] ?? null
  const current = roomFor(chosen)

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="gallery-head">
        <div>
          <h1 className="admin-h1">Room</h1>
          <p className="admin-meta" style={{ margin: '0.35rem 0 0', lineHeight: 1.6 }}>
            Every product page shows the print twice: on a plain wall, and hanging in the room
            you pick here. Nothing to set up per photograph — a new print is mocked up the
            moment you publish it.
          </p>
        </div>
      </div>

      {/* ---------- THE CHOICE ---------- */}

      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">
          Pick one
          <span className="admin-where">shown on every product page</span>
        </h2>

        <div className="room-choices">
          {PRESET_ROOMS.map((room) => {
            const photo = imageFor(room)

            return (
              <form key={room.id} action={setShopRoom.bind(null, room.id)}>
                <button
                  type="submit"
                  className="room-choice"
                  data-chosen={room.id === chosen}
                  aria-pressed={room.id === chosen}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.src} srcSet={photo.srcSet} sizes="240px" alt="" />
                  <span className="room-choice-name">{room.name}</span>
                  <span className="room-choice-note">{room.note}</span>
                </button>
              </form>
            )
          })}
        </div>

        <form action={setShopRoom.bind(null, 'none')} className="room-none">
          <button type="submit" className="scene-btn scene-btn-quiet" disabled={chosen === 'none'}>
            {chosen === 'none' ? 'No room — plain wall only' : 'Use no room at all'}
          </button>
          <span className="admin-meta">
            The print still shows framed on a plain wall, which is the first view either way.
          </span>
        </form>
      </div>

      {/* ---------- HOW IT LOOKS ---------- */}

      {current && (
        <div className="admin-panel">
          <h2 className="admin-h2">
            {current.name}
            <span className="admin-where">as a customer sees it</span>
          </h2>

          {sample ? (
            <>
              <div className="scene-preview">
                <RoomScene
                  room={current}
                  imageUrl={displayUrl(sample.photo)}
                  srcSet={srcSetFor(sample.photo)}
                  alt=""
                  width={sample.photo.width}
                  height={sample.photo.height}
                  sizes="(max-width: 900px) 92vw, 760px"
                  eager
                />
              </div>
              <p className="admin-meta" style={{ marginTop: '0.6rem', lineHeight: 1.6 }}>
                Showing the first print in your catalogue. The frame is exposed down to this
                room&rsquo;s own light and picks up the wall&rsquo;s colour, which is what stops
                it looking pasted on — so a print will read darker here than on the plain wall.
                That&rsquo;s the room, not the file.
              </p>
            </>
          ) : (
            <p className="admin-meta" style={{ lineHeight: 1.6 }}>
              Publish a print in the <Link href="/admin/shop/catalog">catalogue</Link> and
              it&rsquo;ll appear here, hanging on this wall.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
