import { createClient } from '@/lib/supabase/server'

/**
 * Brings a photograph's buyable options in line with its for-sale flag.
 *
 * Listing a photo copies the current price list onto product rows rather than
 * pointing at it. That's deliberate: editing a price later changes what new
 * listings cost, not what a customer is looking at right now. A shop that
 * silently reprices everything under the visitor is how you end up honouring
 * a number nobody meant to publish.
 *
 * Unlisting deactivates rather than deletes, so relisting restores the
 * original prices instead of quietly adopting today's.
 */
export async function syncProductsForPhoto(photoId: string): Promise<void> {
  const supabase = await createClient()

  const { data: photo } = await supabase
    .from('photos')
    .select('id, is_for_sale')
    .eq('id', photoId)
    .maybeSingle()

  if (!photo) return

  const { data: existingRows } = await supabase
    .from('products')
    .select('id, print_option_id, is_active')
    .eq('photo_id', photoId)

  const existing = existingRows ?? []

  // Unlisted: stand every option down, keep the rows and their prices
  if (!photo.is_for_sale) {
    if (existing.some((p) => p.is_active)) {
      await supabase.from('products').update({ is_active: false }).eq('photo_id', photoId)
    }
    return
  }

  const { data: optionRows } = await supabase
    .from('print_options')
    .select('id, label, kind, price_cents, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const options = optionRows ?? []
  const byOption = new Map(existing.map((p) => [p.print_option_id, p]))

  const revive: string[] = []
  const create: Record<string, unknown>[] = []

  for (const [index, option] of options.entries()) {
    const match = byOption.get(option.id)

    if (match) {
      if (!match.is_active) revive.push(match.id)
      continue
    }

    create.push({
      photo_id: photoId,
      print_option_id: option.id,
      type: option.kind,
      size_label: option.label,
      price_cents: option.price_cents,
      sort_order: index + 1,
      is_active: true,
    })
  }

  // Options retired from the price list since this photo was listed
  const liveOptionIds = new Set(options.map((o) => o.id))
  const orphaned = existing
    .filter((p) => p.is_active && !liveOptionIds.has(p.print_option_id))
    .map((p) => p.id)

  await Promise.all([
    revive.length > 0
      ? supabase.from('products').update({ is_active: true }).in('id', revive)
      : null,
    create.length > 0 ? supabase.from('products').insert(create) : null,
    orphaned.length > 0
      ? supabase.from('products').update({ is_active: false }).in('id', orphaned)
      : null,
  ])
}
