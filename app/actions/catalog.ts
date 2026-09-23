'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { parseMoneyToCents } from '@/lib/shop'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

/**
 * Saves one catalogue entry: its selling copy, its categories and tags, and
 * the sizes it's offered in.
 *
 * Sizes are per product here rather than read from the global price list. The
 * list seeds a new entry; after that each print can carry its own sizes and
 * prices, because a panorama and a portrait rarely sell in the same formats.
 */
export async function saveCatalogItem(photoId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const text = (key: string) => (formData.get(key) as string)?.trim() || null

  const tags = (text('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 25)

  // ── The entry itself ──────────────────────────────────────────────────────
  const { error: itemError } = await supabase.from('catalog_items').upsert(
    {
      tenant_id: tenantId,
      photo_id: photoId,
      title: text('title'),
      description: text('description'),
      location: text('location'),
      tags,
      is_published: formData.get('is_published') === 'on',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'photo_id' }
  )

  if (itemError) throw new Error(itemError.message)

  // ── Categories ────────────────────────────────────────────────────────────
  // Replace wholesale: simpler and safer than diffing, and the set is tiny.
  const categoryIds = formData.getAll('category_id').map(String)

  await supabase.from('photo_shop_categories').delete().eq('photo_id', photoId)

  if (categoryIds.length > 0) {
    const { error } = await supabase
      .from('photo_shop_categories')
      .insert(categoryIds.map((category_id) => ({ photo_id: photoId, category_id })))
    if (error) throw new Error(error.message)
  }

  // ── Sizes ─────────────────────────────────────────────────────────────────
  // Matched by hidden id, never by position, so removing a middle row can't
  // shift one row's price onto another.
  const ids = formData.getAll('product_id').map(String)
  const removals = ids.filter((id) => formData.get(`remove_${id}`) === 'on')
  const keepers = ids.filter((id) => !removals.includes(id))

  if (removals.length > 0) {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('tenant_id', tenantId)
      .in('id', removals)
    if (error) throw new Error(error.message)
  }

  await Promise.all(
    keepers.map((id, index) => {
      const label = (formData.get(`label_${id}`) as string)?.trim()
      const priceCents = parseMoneyToCents(formData.get(`price_${id}`) as string)

      const updates: Record<string, unknown> = {
        sort_order: index + 1,
        is_active: formData.get(`active_${id}`) === 'on',
        type: (formData.get(`kind_${id}`) as string) || 'print',
      }

      // Don't overwrite a real value with a blank field or a NaN
      if (label) updates.size_label = label
      if (priceCents !== null) updates.price_cents = priceCents

      return supabase.from('products').update(updates).eq('tenant_id', tenantId).eq('id', id)
    })
  )

  // ── A newly added size ────────────────────────────────────────────────────
  const newLabel = text('new_label')
  const newPrice = parseMoneyToCents(formData.get('new_price') as string)

  if (newLabel && newPrice !== null) {
    const { error } = await supabase.from('products').insert({
      tenant_id: tenantId,
      photo_id: photoId,
      size_label: newLabel,
      type: text('new_kind') ?? 'print',
      price_cents: newPrice,
      sort_order: keepers.length + 1,
      is_active: true,
    })
    if (error) throw new Error(error.message)
  }

  revalidatePath('/admin/shop/catalog')
  revalidatePath(`/admin/shop/catalog/${photoId}`)
  revalidatePath('/shop')
  revalidatePath(`/shop/${photoId}`)
}

/**
 * Takes a print off the shop without unmarking the photograph. The entry and
 * its prices survive, so republishing restores exactly what was there.
 */
export async function setCatalogPublished(photoId: string, publish: boolean) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { error } = await supabase
    .from('catalog_items')
    .upsert(
      {
        tenant_id: tenantId,
        photo_id: photoId,
        is_published: publish,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'photo_id' }
    )

  if (error) throw new Error(error.message)

  revalidatePath('/admin/shop/catalog')
  revalidatePath('/shop')
  revalidatePath(`/shop/${photoId}`)
}

export async function saveAndReturn(photoId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  await saveCatalogItem(photoId, formData)
  redirect('/admin/shop/catalog')
}
