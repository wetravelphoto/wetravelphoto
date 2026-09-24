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
 *
 * **The site is passed in, not assumed.** Every query here used to be keyed on
 * a photograph id alone, which was fine when there was one site and wrong the
 * moment there were two: the price list it copied from was read WITHOUT a
 * tenant, and `print_options` carries a permissive "anyone reads active
 * options" policy — so listing a print on one site would have priced it from
 * a mixture of every site's price list. The catalogue entry it wrote had no
 * tenant either, so it landed on whichever site `default_tenant_id()` names:
 * the oldest one.
 */
export async function syncProductsForPhoto(
  tenantId: string,
  photoId: string
): Promise<void> {
  const supabase = await createClient()

  const { data: photo } = await supabase
    .from('photos')
    .select('id, is_for_sale')
    .eq('tenant_id', tenantId)
    .eq('id', photoId)
    .maybeSingle()

  if (!photo) return

  // Marking a photograph for sale puts it in the catalogue. The entry is
  // upserted rather than inserted, so unmarking and remarking a print brings
  // back its title, description and tags instead of a blank record.
  if (photo.is_for_sale) {
    await supabase
      .from('catalog_items')
      .upsert(
        { tenant_id: tenantId, photo_id: photoId },
        { onConflict: 'photo_id', ignoreDuplicates: true }
      )
  }

  const { data: existingRows } = await supabase
    .from('products')
    .select('id, print_option_id, is_active')
    .eq('tenant_id', tenantId)
    .eq('photo_id', photoId)

  const existing = existingRows ?? []

  // Unlisted: stand every option down, keep the rows and their prices
  if (!photo.is_for_sale) {
    if (existing.some((p) => p.is_active)) {
      await supabase
        .from('products')
        .update({ is_active: false })
        .eq('tenant_id', tenantId)
        .eq('photo_id', photoId)
    }
    return
  }

  const { data: optionRows } = await supabase
    .from('print_options')
    .select('id, label, kind, price_cents, sort_order')
    .eq('tenant_id', tenantId)
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
      tenant_id: tenantId,
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
      ? supabase
          .from('products')
          .update({ is_active: true })
          .eq('tenant_id', tenantId)
          .in('id', revive)
      : null,
    create.length > 0 ? supabase.from('products').insert(create) : null,
    orphaned.length > 0
      ? supabase
          .from('products')
          .update({ is_active: false })
          .eq('tenant_id', tenantId)
          .in('id', orphaned)
      : null,
  ])
}
