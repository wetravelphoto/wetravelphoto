export type DateFormat = 'full' | 'month_year' | 'year'

/** Formats a trip date according to the album's chosen precision. */
export function formatTripDate(value: string | null, format: string | null): string | null {
  if (!value) return null

  // Parse as a plain calendar date so timezones can't shift the day
  const [y, m, d] = value.split('T')[0].split('-').map(Number)
  if (!y) return null
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)

  switch (format) {
    case 'year':
      return String(y)
    case 'full':
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    default:
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
}
