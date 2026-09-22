'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { parseMoneyToCents, slugifyCategory } from '@/lib/shop'
import { revalidatePath } from 'next/cache'

const SHOP_PATHS = ['/admin/shop', '/shop']

function refresh() {
  SHOP_PATHS.forEach((p) => revalidatePath(p))
}

const text = (formData: FormData, key: string) => (formData.get(key) as string)?.trim() || null

// ── Print options ────────────────────────────────────────────────────────────

export async function createPrintOption(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const label = text(formData, 'label')
  const priceCents = parseMoneyToCents(formData.get('price') as string)

  // A size with no label or no usable price isn't a size
  if (!label || priceCents === null) return

  const supabase = await createClient()

  const { data: last } = await supabase
    .from('print_options')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)

  const { error } = await supabase.from('print_options').insert({
    label,
    kind: text(formData, 'kind') ?? 'print',
    price_cents: priceCents,
    sort_order: (last?.[0]?.sort_order ?? 0) + 1,
  })

  if (error) throw new Error(error.message)
  refresh()
}

/**
 * Saves every existing row in one submit, and deletes the ones ticked for
 * removal. Rows are matched by a hidden id rather than by position, so a
 * delete in the middle can't shift the wrong values onto the wrong row.
 */
export async function savePrintOptions(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()
  const ids = formData.getAll('option_id').map(String)

  const removals = ids.filter((id) => formData.get(`remove_${id}`) === 'on')
  const keepers = ids.filter((id) => !removals.includes(id))

  if (removals.length > 0) {
    const { error } = await supabase.from('print_options').delete().in('id', removals)
    if (error) throw new Error(error.message)
  }

  await Promise.all(
    keepers.map((id, index) => {
      const label = (formData.get(`label_${id}`) as string)?.trim()
      const priceCents = parseMoneyToCents(formData.get(`price_${id}`) as string)

      const updates: Record<string, unknown> = {
        sort_order: index + 1,
        is_active: formData.get(`active_${id}`) === 'on',
        kind: (formData.get(`kind_${id}`) as string) || 'print',
      }

      // Leave the stored value alone rather than writing an empty label or a NaN
      if (label) updates.label = label
      if (priceCents !== null) updates.price_cents = priceCents

      return supabase.from('print_options').update(updates).eq('id', id)
    })
  )

  refresh()
}

// ── Categories ───────────────────────────────────────────────────────────────

export async function createShopCategory(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const name = text(formData, 'name')
  if (!name) return

  const supabase = await createClient()

  const { data: last } = await supabase
    .from('shop_categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)

  const { error } = await supabase.from('shop_categories').insert({
    name,
    slug: slugifyCategory(name),
    sort_order: (last?.[0]?.sort_order ?? 0) + 1,
  })

  // A duplicate slug trips the unique index — say so plainly
  if (error) {
    throw new Error(
      error.code === '23505' ? `There's already a category called "${name}".` : error.message
    )
  }

  refresh()
}

export async function saveShopCategories(formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()
  const ids = formData.getAll('category_id').map(String)

  const removals = ids.filter((id) => formData.get(`remove_${id}`) === 'on')
  const keepers = ids.filter((id) => !removals.includes(id))

  // photo_shop_categories cascades, so the assignments go with the category
  if (removals.length > 0) {
    const { error } = await supabase.from('shop_categories').delete().in('id', removals)
    if (error) throw new Error(error.message)
  }

  await Promise.all(
    keepers.map((id, index) => {
      const name = (formData.get(`name_${id}`) as string)?.trim()

      const updates: Record<string, unknown> = { sort_order: index + 1 }

      // The slug is part of the public URL, so it follows the name
      if (name) {
        updates.name = name
        updates.slug = slugifyCategory(name)
      }

      return supabase.from('shop_categories').update(updates).eq('id', id)
    })
  )

  refresh()
}
