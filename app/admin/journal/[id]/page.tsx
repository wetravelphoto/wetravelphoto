import { createClient } from '@/lib/supabase/server'
import { updatePost, deletePost } from '@/app/actions/blog'
import BlockEditor from '@/components/admin/BlockEditor'
import PostMetaFields from '@/components/admin/PostMetaFields'
import PostActions from '@/components/admin/PostActions'
import SeoFields from '@/components/admin/SeoFields'
import { siteUrl } from '@/lib/site'
import ConfirmButton from '@/components/admin/ConfirmButton'
import type { Block } from '@/lib/blocks'
import Link from 'next/link'
import '@/app/journal/journal.css'
import { requireEditor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data: post } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .single()
  const { data: albums } = await supabase
    .from('albums')
    .select('id, title')
    .eq('tenant_id', tenantId)
    .order('title')

  const { data: allPosts } = await supabase
    .from('blog_posts')
    .select('category, tags')
    .eq('tenant_id', tenantId)
  const categories = Array.from(
    new Set((allPosts ?? []).map((p) => p.category).filter(Boolean) as string[])
  ).sort()
  const tagSuggestions = Array.from(
    new Set((allPosts ?? []).flatMap((p) => (p.tags as string[] | null) ?? []))
  ).sort()

  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''
  const blocks = (post?.blocks as Block[] | null) ?? []

  return (
    <div style={{ maxWidth: 1100 }}>
      <form action={updatePost.bind(null, id)} autoComplete="off">
        <PostActions status={post?.status ?? 'draft'} title={post?.title} slug={post?.slug} />

        <p className="admin-crumb">
          <Link href="/admin/blog">← All stories</Link>
        </p>

        <PostMetaFields
          title={post?.title ?? ''}
          slug={post?.slug ?? ''}
          excerpt={post?.excerpt ?? ''}
          category={post?.category ?? ''}
          byline={post?.byline ?? ''}
          categories={categories}
          albumId={post?.album_id ?? ''}
          albums={albums ?? []}
          featuredPath={post?.featured_custom_path ?? null}
          tags={(post?.tags as string[] | null) ?? []}
          tagSuggestions={tagSuggestions}
          publicUrl={publicUrl}
        />

        <div style={{ marginTop: '1.5rem' }}>
          <h2 className="admin-h2">Story</h2>
          <BlockEditor
            initialBlocks={blocks}
            publicUrl={publicUrl}
            title={post?.title ?? ''}
            category={post?.category ?? null}
            featuredPath={post?.featured_custom_path ?? null}
          />
        </div>

        <SeoFields
          seoTitle={post?.seo_title ?? ''}
          seoDescription={post?.seo_description ?? ''}
          noindex={post?.noindex ?? false}
          fallbackTitle={post?.title ?? ''}
          fallbackDescription={post?.excerpt ?? ''}
          slug={post?.slug ?? ''}
          host={(await siteUrl()).replace(/^https?:\/\//, '')}
        />
      </form>

      <form action={deletePost.bind(null, id)} style={{ marginTop: '1.5rem' }}>
        <ConfirmButton label="Delete story" confirmLabel="Confirm delete" />
      </form>
    </div>
  )
}
