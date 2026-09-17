import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDraftPage, draftStatus, draftStyleSettings } from '@/lib/drafts/store'
import { resolveTokens } from '@/lib/styles/tokens'
import Canvas, { type CanvasSection } from '@/components/canvas/Canvas'
import '@/app/edit/canvas.css'

/**
 * THE CANVAS
 * ══════════
 *
 * The page on the left, the page's own preview in the middle, whatever is
 * selected on the right. Dark, full-bleed, and outside /admin so it does not
 * inherit the sidebar — an editor with an admin nav down one side is an admin
 * screen with a picture in it, which is the thing this replaces.
 *
 * Nothing here writes. Opening the editor does not start a draft; the first
 * EDIT does. A photographer who opens the canvas, looks around and closes it
 * again should leave no trace, and should certainly not end up with a "you have
 * unpublished changes" banner they never earned.
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  robots: { index: false, follow: false },
}

const PAGES: Record<string, string> = { home: 'Homepage' }

export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ page: string }>
  searchParams: Promise<{ mode?: string }>
}) {
  const { page } = await params
  const { mode } = await searchParams
  if (!PAGES[page]) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/admin/login')

  const [{ sections, legacy }, status, style] = await Promise.all([
    loadDraftPage(page),
    draftStatus(),
    // The draft's tokens if it has any, otherwise the live site's — so opening
    // Style shows what is actually on screen rather than the saved defaults.
    draftStyleSettings(),
  ])

  const rows: CanvasSection[] = sections.map((s) => ({
    id: s.id,
    type: s.type,
    label: s.def.label,
    blurb: s.def.blurb,
    permanent: !!s.def.permanent,
    visible: s.visible,
    settings: s.settings,
  }))

  return (
    <Canvas
      page={page}
      title={PAGES[page]}
      sections={rows}
      legacy={legacy}
      missing={status.missing}
      hasDraft={status.hasDraft}
      draftUpdatedAt={status.updatedAt}
      publicUrl={process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''}
      tokens={resolveTokens(style.global_styles, style.global_styles_version)}
      initialMode={mode === 'style' ? 'style' : 'content'}
    />
  )
}
