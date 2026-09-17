import type { Field, SectionDef, SectionSettings } from '@/lib/sections/registry'

/**
 * FORM → SETTINGS
 * ═══════════════
 *
 * Reads a section's submitted panel back into its settings object, using the
 * kind declared in the registry rather than any per-section parsing code. This
 * is the other half of why the field schema exists: SectionFields draws a panel
 * from `fields`, and this puts the values back from the same declarations. A
 * new setting is one line in the registry and needs no code on either side, and
 * no section can quietly save a string into a number.
 *
 * Shared by the old section forms and by the canvas, so both read a panel
 * identically. They wrote the same forty lines twice for about a day.
 */

/**
 * A field the panel did not draw — hidden by its `when`, or a custom editor —
 * is left exactly as it was. The panel marks what it drew with a hidden
 * `__present_<key>` input, because an unchecked checkbox is indistinguishable
 * from a field that was never on the page, and without the marker every save
 * would wipe whatever was conditionally hidden at the time.
 */
export function readField(field: Field, formData: FormData, current: SectionSettings): unknown {
  if (!formData.has(`__present_${field.key}`)) return current[field.key]

  switch (field.kind) {
    case 'toggle':
      return formData.get(field.key) === 'on'

    case 'number': {
      const raw = Number((formData.get(field.key) as string) ?? '')
      if (!Number.isFinite(raw)) return current[field.key]
      const min = field.min ?? -Infinity
      const max = field.max ?? Infinity
      return Math.min(max, Math.max(min, raw))
    }

    case 'custom':
      return current[field.key]

    default: {
      const raw = ((formData.get(field.key) as string) ?? '').trim()
      return raw === '' ? null : raw
    }
  }
}

/** Every field of a section, read back out of its submitted panel. */
export function readSettingsFromForm(
  def: SectionDef,
  formData: FormData,
  current: SectionSettings
): SectionSettings {
  const next: SectionSettings = { ...current }

  for (const field of def.fields) {
    // A custom field is edited elsewhere; the generic panel never draws it and
    // this must not blank it.
    if (field.kind === 'custom') continue
    next[field.key] = readField(field, formData, current)
  }

  return next
}
