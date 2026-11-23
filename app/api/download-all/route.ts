import { r2Client } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { createRequire } from 'module'
import {
  accessForToken,
  albumForZip,
  favoritePhotosForZip,
  photosForZip as photosForTokenZip,
  recordDownload,
} from '@/lib/gallery-access'
import { albumAllowsPublicDownload, photosForZip } from '@/lib/album-access'

// archiver is CommonJS, so a default import can't be interoped at build time
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const archiver = require('archiver') as any

// Node streams are required here, so this route can't run on the edge
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Streams a whole gallery as a zip.
 *
 * Two ways in, and they are checked separately:
 *   · a share token that opens this album
 *   · a public album whose owner turned downloads on
 *
 * The token path was previously dead code: it looked for `access_token` on
 * album_clients, where that column does not exist, so the lookup always came
 * back empty and a client could only get a zip if the album happened to allow
 * public downloads. Fixed here.
 */
export async function GET(request: NextRequest) {
  const albumId = request.nextUrl.searchParams.get('album')
  const token = request.nextUrl.searchParams.get('token')
  // "Download favourites": only this client's favourites of this album. Only
  // meaningful with a token — favourites belong to a client — so a public zip
  // never takes it.
  const onlyFavorites = request.nextUrl.searchParams.get('favorites') === '1'

  if (!albumId) return NextResponse.json({ error: 'Missing album' }, { status: 400 })

  let album: Record<string, unknown> | null = null
  let photos: Record<string, unknown>[] = []
  let access = null

  if (token) {
    access = await accessForToken(token)

    if (access) {
      const opened = await albumForZip(access, albumId)
      // The album's download switch governs the token path too: a client
      // whose page shows no download button gets no zip by typing the URL.
      if (opened && opened.allow_downloads !== true) {
        return NextResponse.json({ error: 'Downloads are not enabled' }, { status: 403 })
      }
      album = opened
      if (album) {
        if (onlyFavorites) {
          try {
            photos = await favoritePhotosForZip(access, albumId)
          } catch {
            return NextResponse.json({ error: 'Favourites could not be read' }, { status: 503 })
          }
        } else {
          photos = await photosForTokenZip(access, albumId)
        }
      }
    }
  }

  if (onlyFavorites && !album) {
    return NextResponse.json({ error: 'Downloads are not enabled' }, { status: 403 })
  }

  if (!album) {
    // No token, or a token that does not open this album. The only other way
    // in is an album that is public AND has downloads switched on.
    album = await albumAllowsPublicDownload(albumId)
    if (album) photos = await photosForZip(albumId)
  }

  if (!album) {
    return NextResponse.json({ error: 'Downloads are not enabled' }, { status: 403 })
  }

  if (photos.length === 0) {
    return NextResponse.json({ error: 'Nothing to download' }, { status: 404 })
  }

  const slug = `${(album.slug as string) || 'gallery'}${onlyFavorites ? '-favorites' : ''}`
  const archive = archiver('zip', { zlib: { level: 1 } })

  // Level 1: photos are already compressed, so heavy zipping costs time
  // without meaningfully shrinking the file.
  const stream = new ReadableStream({
    start(controller) {
      archive.on('data', (chunk: Uint8Array) => controller.enqueue(chunk))
      archive.on('end', () => controller.close())
      archive.on('error', (err: Error) => controller.error(err))

      void (async () => {
        for (const [index, photo] of photos.entries()) {
          try {
            // Originals where we have them, display copies otherwise
            const key = (photo.original_path as string) ?? (photo.storage_path as string)

            const object = await r2Client.send(
              new GetObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME!,
                Key: key,
              })
            )

            if (!object.Body) continue

            const name = key.split('/').pop() ?? `photo-${index + 1}.jpg`
            archive.append(object.Body as Readable, { name: `${slug}/${name}` })
          } catch {
            // A missing object shouldn't sink the whole archive
          }
        }

        await archive.finalize()
      })()
    },
  })

  // Record it so it shows in the album's stats. Only a client download has
  // someone to attribute it to.
  if (access) await recordDownload(access, null)

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
