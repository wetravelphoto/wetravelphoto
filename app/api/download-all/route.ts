import { createClient } from '@/lib/supabase/server'
import { r2Client } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { createRequire } from 'module'

// archiver is CommonJS, so a default import can't be interoped at build time
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const archiver = require('archiver') as any

// Node streams are required here, so this route can't run on the edge
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Streams a whole gallery as a zip. Access is checked the same way single
 * downloads are: a client token, or an album that permits downloads.
 */
export async function GET(request: NextRequest) {
  const albumId = request.nextUrl.searchParams.get('album')
  const token = request.nextUrl.searchParams.get('token')

  if (!albumId) return NextResponse.json({ error: 'Missing album' }, { status: 400 })

  const supabase = await createClient()

  const { data: album } = await supabase
    .from('albums')
    .select('id, title, slug, privacy_type, allow_downloads')
    .eq('id', albumId)
    .maybeSingle()

  if (!album) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // A token means a client gallery; otherwise the album has to allow it
  let allowed = album.allow_downloads === true

  if (token) {
    const { data: share } = await supabase
      .from('album_clients')
      .select('album_id, clients(id)')
      .eq('access_token', token)
      .eq('album_id', albumId)
      .maybeSingle()

    if (share) allowed = true
  }

  if (!allowed) return NextResponse.json({ error: 'Downloads are not enabled' }, { status: 403 })

  const { data: photos } = await supabase
    .from('photos')
    .select('storage_path, original_path, caption')
    .eq('album_id', albumId)
    .order('sort_order')

  if (!photos || photos.length === 0) {
    return NextResponse.json({ error: 'Nothing to download' }, { status: 404 })
  }

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
            const key = photo.original_path ?? photo.storage_path

            const object = await r2Client.send(
              new GetObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME!,
                Key: key,
              })
            )

            if (!object.Body) continue

            const name = key.split('/').pop() ?? `photo-${index + 1}.jpg`
            archive.append(object.Body as Readable, { name: `${album.slug}/${name}` })
          } catch {
            // A missing object shouldn't sink the whole archive
          }
        }

        await archive.finalize()
      })()
    },
  })

  // Record the download so it shows in the album's stats
  await supabase.from('downloads').insert({
    album_id: albumId,
    photo_id: null,
    downloaded_at: new Date().toISOString(),
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${album.slug || 'gallery'}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
