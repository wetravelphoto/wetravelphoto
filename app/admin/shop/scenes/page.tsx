import { getRoomScenes } from '@/lib/scenes'
import { getPublishedCatalog } from '@/lib/catalog'
import { uploadRoomScene, saveRoomScene, deleteRoomScene } from '@/app/actions/scenes'
import { displayUrl, srcSetFor } from '@/lib/srcset'
import SceneEditor from '@/components/admin/SceneEditor'
import RoomScene from '@/components/shop/RoomScene'
import Toggle from '@/components/admin/Toggle'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function RoomScenesPage() {
  const [scenes, catalog] = await Promise.all([getRoomScenes(true), getPublishedCatalog()])

  // Preview against a real print if there is one, so the corners can be judged
  // against the thing they'll actually carry
  const sample = catalog[0] ?? null

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="gallery-head">
        <div>
          <h1 className="admin-h1">Rooms</h1>
          <p className="admin-meta" style={{ margin: '0.35rem 0 0', lineHeight: 1.6 }}>
            {scenes.length === 0
              ? 'No rooms yet.'
              : `${scenes.length} room${scenes.length === 1 ? '' : 's'}.`}{' '}
            Every print in the shop is hung in every room you add here — nothing is set up per
            photograph, and a new print is mocked up the moment you publish it.
          </p>
        </div>
      </div>

      {/* ---------- ADD ---------- */}

      <form action={uploadRoomScene} className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Add a room</h2>
        <p className="admin-meta" style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
          Either a room with a clear stretch of empty wall, or one of the stock interior mockups
          that already has an empty frame hanging in it — there&rsquo;s a switch for which.
          Straight on or at an angle both work; you mark the corners next.
        </p>

        <label className="admin-field">
          Name
          <input type="text" name="name" placeholder="Living room" className="admin-input" />
        </label>

        <label className="admin-field">
          Photograph
          <input type="file" name="file" accept="image/*" required className="admin-input" />
        </label>

        <button type="submit" className="scene-btn">
          Upload
        </button>
      </form>

      {/* ---------- EACH ROOM ---------- */}

      {scenes.map((scene) => (
        <form
          key={scene.id}
          action={saveRoomScene.bind(null, scene.id)}
          className="admin-panel"
          style={{ marginBottom: '1.25rem' }}
        >
          <h2 className="admin-h2">{scene.name}</h2>

          <SceneEditor scene={scene} />

          {sample && (
            <>
              <p
                className="admin-meta"
                style={{ margin: '1.25rem 0 0.5rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}
              >
                As a customer sees it
              </p>
              <div className="scene-preview">
                <RoomScene
                  scene={scene}
                  imageUrl={displayUrl(sample.photo)}
                  srcSet={srcSetFor(sample.photo)}
                  alt=""
                  width={sample.photo.width}
                  height={sample.photo.height}
                  sizes="(max-width: 900px) 92vw, 620px"
                />
              </div>
              <p className="admin-meta" style={{ marginTop: '0.5rem' }}>
                Showing the first print in your catalogue. The preview updates when you save.
              </p>
            </>
          )}

          <label className="admin-field" style={{ marginTop: '1.25rem' }}>
            Name
            <input
              type="text"
              name="name"
              defaultValue={scene.name}
              className="admin-input"
            />
          </label>

          <Toggle
            name="has_frame"
            label="This room already has a frame in it"
            defaultChecked={scene.hasFrame}
            note="On: mark the corners of the artwork opening inside the existing frame, and only the photograph is placed — the frame in the picture keeps its own light and shadow. Off: mark the bare wall and the whole framed piece is drawn onto it."
          />

          <Toggle
            name="is_active"
            label="Show this room"
            defaultChecked={scene.isActive}
            note="Turn off to keep the room without showing it in the shop."
          />

          <div className="scene-actions">
            <button type="submit" className="scene-btn">
              Save room
            </button>
            <button
              type="submit"
              formAction={deleteRoomScene.bind(null, scene.id)}
              className="scene-btn scene-btn-danger"
            >
              Delete
            </button>
          </div>
        </form>
      ))}

      {scenes.length === 0 && (
        <div className="admin-empty">
          <p style={{ margin: 0, lineHeight: 1.7 }}>
            Until you add one, a product page shows the print framed on a plain wall — which is
            perfectly respectable, just quieter. One good room photograph is enough to start.
          </p>
        </div>
      )}

      {catalog.length === 0 && scenes.length > 0 && (
        <p className="admin-meta" style={{ lineHeight: 1.6 }}>
          Publish a print in the <Link href="/admin/shop/catalog">catalogue</Link> and it&rsquo;ll
          appear in these previews.
        </p>
      )}
    </div>
  )
}
