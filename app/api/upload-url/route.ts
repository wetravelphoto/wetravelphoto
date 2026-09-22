import { createClient } from '@/lib/supabase/server'
import { currentEditor } from '@/lib/auth'
import { tenantKey } from '@/lib/storage-keys'
import { r2Client } from '@/lib/r2'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/tiff': 'tif',
  'image/avif': 'avif',
}

/**
 * Hands back a short-lived URL the browser can upload straight to R2 with.
 * Files never pass through the server, so there's no request size limit —
 * serverless functions cap bodies at a few megabytes, which full-resolution
 * photographs comfortably exceed.
 */
export async function POST(request: NextRequest) {
  // Signed in AND able to edit a site — and that site decides where the file
  // goes. A signed URL is a write into the shared bucket, so it is handed out
  // only for this site's own prefix (lib/storage-keys.ts).
  const editor = await currentEditor()
  if (!editor) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!editor.platformAdmin && !['owner', 'admin', 'editor'].includes(editor.role)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  const { albumId, folder, contentType } = (await request.json()) as {
    albumId?: string
    folder?: string
    contentType?: string
  }

  // An album must be one this account can see — row-level security answers
  // that — or the upload would sit under another site's gallery id.
  if (albumId) {
    const supabase = await createClient()
    const { data: album } = await supabase.from('albums').select('id').eq('id', albumId).maybeSingle()
    if (!album) return NextResponse.json({ error: 'No such gallery' }, { status: 404 })
  }

  // Album photos live under the album; journal images and the ones uploaded
  // from the editor's photo picker have their own folders but use the same
  // signed-upload flow. The list is closed on purpose: `folder` comes from the
  // browser, and anything not named here has no destination.
  const FOLDERS: Record<string, string> = { journal: 'journal', site: 'site-images' }
  const folderPath = albumId ? `photos/${albumId}` : (FOLDERS[folder ?? ''] ?? null)
  if (!folderPath) return NextResponse.json({ error: 'Missing destination' }, { status: 400 })

  const prefix = tenantKey(editor.tenantId, folderPath)

  const extension = ALLOWED[contentType ?? '']
  if (!extension) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
  }

  const base = `${prefix}/${randomUUID()}`
  const key = `${base}/original.${extension}`

  const url = await getSignedUrl(
    r2Client,
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 600 }
  )

  return NextResponse.json({ url, key, base })
}
