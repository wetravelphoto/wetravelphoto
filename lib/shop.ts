import { createClient } from '@/lib/supabase/server'
import { currentSiteTenantId } from '@/lib/tenant'

export type PrintOption = {
  id: string
  label: string
  kind: string
  price_cents: number
  sort_order: number
  is_active: boolean
}

export type ShopCategory = {
  id: string
  name: string
  slug: string
  sort_order: number
}

export type Product = {
  id: string
  photo_id: string
  type: string | null
  size_label: string | null
  price_cents: number
  is_active: boolean
  sort_order: number
  print_option_id: string | null
}

/** Money is stored as integer cents everywhere. Never floats. */
export function formatMoney(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

/** The value for a dollars text input — always two decimals, no symbol. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Parse a typed dollar amount into cents. Tolerates '$', commas and spaces.
 * Returns null for anything that isn't a usable non-negative number, so the
 * caller can leave the stored value alone rather than writing a NaN.
 */
export function parseMoneyToCents(input: string | null | undefined): number | null {
  if (!input) return null

  const cleaned = String(input).replace(/[$,\s]/g, '')
  if (!cleaned) return null

  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null

  return Math.round(value * 100)
}

export function slugifyCategory(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'category'
  )
}

export async function getPrintOptions(includeInactive = false): Promise<PrintOption[]> {
  const tenantId = await currentSiteTenantId()
  if (!tenantId) return []

  const supabase = await createClient()

  let query = supabase
    .from('print_options')
    .select('id, label, kind, price_cents, sort_order, is_active')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (!includeInactive) query = query.eq('is_active', true)

  const { data } = await query
  return (data ?? []) as PrintOption[]
}

export async function getShopCategories(): Promise<ShopCategory[]> {
  const tenantId = await currentSiteTenantId()
  if (!tenantId) return []

  const supabase = await createClient()

  const { data } = await supabase
    .from('shop_categories')
    .select('id, name, slug, sort_order')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  return (data ?? []) as ShopCategory[]
}

/** How many photos are currently listed for sale. */
export async function countPhotosForSale(): Promise<number> {
  const tenantId = await currentSiteTenantId()
  if (!tenantId) return 0

  const supabase = await createClient()

  const { count } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('is_for_sale', true)

  return count ?? 0
}
