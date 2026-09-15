import { r2Client } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'
import { accessForToken, photoForDownload, recordDownload } from '@/lib/gallery-access'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const photoId = request.nextUrl.searchParams.get('photo')

  if (!token || !photoId) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
  }

  const access = await accessForToken(token)

  if (!access) {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 403 })
  }

  // Null covers both "no such photograph" and "not in an album this link
  // opens" — the two are the same answer from outside, and separating them
  // would let someone probe for photo ids.
  const photo = await photoForDownload(access, photoId)

  if (!photo) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Clients get the full-resolution original when one exists; photos
  // uploaded before originals were kept fall back to the display copy.
  const key = (photo.original_path as string) ?? (photo.storage_path as string)

  const object = await r2Client.send(
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })
  )

  const bytes = await object.Body!.transformToByteArray()

  await recordDownload(access, photo.id as string)

  const filename = key.split('/').pop() ?? 'photo.jpg'

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
