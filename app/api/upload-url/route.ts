import { createClient } from '@/lib/supabase/server'
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
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { albumId, folder, contentType } = (await request.json()) as {
    albumId?: string
    folder?: string
    contentType?: string
  }

  // Album photos live under the album; journal and branding images have their
  // own folders but use the same signed-upload flow.
  const prefix = albumId ? `photos/${albumId}` : folder === 'journal' ? 'journal' : null

  if (!prefix) return NextResponse.json({ error: 'Missing destination' }, { status: 400 })

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
