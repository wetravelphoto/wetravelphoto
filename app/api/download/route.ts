import { createClient } from '@/lib/supabase/server'
import { r2Client } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const photoId = request.nextUrl.searchParams.get('photo')

  if (!token || !photoId) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('access_token', token)
    .maybeSingle()

  if (!client) {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 403 })
  }

  const { data: photo } = await supabase
    .from('photos')
    .select('id, album_id, storage_path, original_path')
    .eq('id', photoId)
    .maybeSingle()

  if (!photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
  }

  // Confirm this client actually has access to the album the photo belongs to
  const { data: share } = await supabase
    .from('album_clients')
    .select('album_id')
    .eq('album_id', photo.album_id)
    .eq('client_id', client.id)
    .maybeSingle()

  if (!share) {
    return NextResponse.json({ error: 'Not authorized for this album' }, { status: 403 })
  }

  // Clients get the full-resolution original when one exists; photos
  // uploaded before originals were kept fall back to the display copy.
  const key = photo.original_path ?? photo.storage_path

  const object = await r2Client.send(
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })
  )

  const bytes = await object.Body!.transformToByteArray()

  await supabase.from('downloads').insert({
    photo_id: photo.id,
    client_id: client.id,
  })

  const filename = key.split('/').pop() ?? 'photo.jpg'

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
