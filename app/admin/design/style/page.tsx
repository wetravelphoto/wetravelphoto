import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import { photoUrl } from '@/lib/images'
import { resolveTokens } from '@/lib/styles/tokens'
import StylePanel from '@/components/admin/StylePanel'
import '@/app/admin/style.css'

export const dynamic = 'force-dynamic'

export default async function StylePage() {
  const settings = await getSiteSettings()
  const tokens = resolveTokens(settings.global_styles, settings.global_styles_version)

  // One of his own photographs for the specimen. Type that looks fine on white
  // can vanish over a picture, and a grey placeholder never shows you that.
  const supabase = await createClient()

  const { data: photo } = await supabase
    .from('photos')
    .select('storage_path, album_id, albums!inner(privacy_type)')
    .eq('albums.privacy_type', 'public')
    .limit(1)
    .maybeSingle()

  const heroPath = settings.hero_image_path ?? (photo?.storage_path as string | undefined) ?? null

  return (
    <div>
      <p className="admin-crumb">
        <Link href="/admin/design">← Design</Link>
      </p>

      <div className="page-editor-head">
        <div>
          <h1 className="admin-h1">Style</h1>
          <p className="admin-meta" style={{ margin: '0.35rem 0 0', maxWidth: '62ch', lineHeight: 1.6 }}>
            Set once, applies everywhere — every page, every gallery, every section. Individual
            sections can still override their own typography on the{' '}
            <Link href="/admin/pages/home" style={{ borderBottom: '0.5px solid currentColor' }}>
              homepage sections
            </Link>
            .
          </p>
        </div>
        <Link href="/" target="_blank" className="admin-btn admin-btn-ghost admin-btn-sm">
          View ↗
        </Link>
      </div>

      <StylePanel initial={tokens} photoUrl={heroPath ? photoUrl(heroPath) : null} />
    </div>
  )
}
