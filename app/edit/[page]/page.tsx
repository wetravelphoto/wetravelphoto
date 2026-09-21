import { PLATFORM } from '@/lib/platform'
import { PAGES, isPage } from '@/lib/sections/pages'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDraftPage, draftStatus, draftStyleSettings } from '@/lib/drafts/store'
import { resolveTokens } from '@/lib/styles/tokens'
import type { TypeStyles } from '@/lib/type-styles'
import { fontHref } from '@/lib/fonts'
import Canvas, { type CanvasSection } from '@/components/canvas/Canvas'
import type { StoryOption } from '@/components/canvas/editors/HeroStories'
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
  title: `Editor · ${PLATFORM.name}`,
  robots: { index: false, follow: false },
}


export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ page: string }>
  searchParams: Promise<{ mode?: string }>
}) {
  const { page } = await params
  const { mode } = await searchParams
  if (!isPage(page)) notFound()

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

  // Published stories, for the hero's story picker. Fetched here rather than in
  // the editor because the editor is a client component and this is a table it
  // has no business reaching into.
  const { data: postRows } = await supabase
    .from('blog_posts')
    .select('id, title, featured_custom_path')
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  const stories: StoryOption[] = (postRows ?? []).map((p) => ({
    id: p.id as string,
    title: (p.title as string) ?? 'Untitled',
    imagePath: (p.featured_custom_path as string) ?? null,
  }))

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
    <>
      {/* The editor's own typeface, loaded only here. Admin chrome, so a
          stylesheet request costs a visitor nothing. */}
      <link rel="stylesheet" href={fontHref('Inter')} />

      <Canvas
      page={page}
      title={PAGES[page].label}
      sections={rows}
      legacy={legacy}
      missing={status.missing}
      hasDraft={status.hasDraft}
      draftUpdatedAt={status.updatedAt}
      publicUrl={process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''}
      tokens={resolveTokens(style.global_styles, style.global_styles_version)}
      typeStyles={(style.type_styles ?? {}) as TypeStyles}
      stories={stories}
      initialMode={mode === 'style' ? 'style' : 'content'}
      />
    </>
  )
}
