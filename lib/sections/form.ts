import { deviceView, type Field, type SectionDef, type SectionSettings } from '@/lib/sections/registry'
import { BASE_DEVICE, DEVICES, deviceKey, type Device } from '@/lib/sections/devices'
import { overrideValue } from '@/lib/sections/backdrop'
import {
  clampNumber,
  normalizeColor,
  normalizeSelect,
  normalizeText,
} from '@/lib/sections/values'

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
 *
 * THE RULES LIVE IN lib/sections/values.ts, shared with the programmatic
 * writer. What is this function's own is the FORM half: pulling a string out of
 * FormData, the `'on'` that is how a checkbox says true, and the failure
 * policy — anything that does not pass leaves the setting exactly as it was,
 * because the panel is on screen and the control snapping back is the message.
 * The other writer throws instead. See the note at the top of values.ts.
 */
export function readField(field: Field, formData: FormData, current: SectionSettings): unknown {
  if (!formData.has(`__present_${field.key}`)) return current[field.key]

  switch (field.kind) {
    case 'toggle':
      return formData.get(field.key) === 'on'

    case 'number': {
      const raw = Number((formData.get(field.key) as string) ?? '')
      if (!Number.isFinite(raw)) return current[field.key]
      return clampNumber(field, raw)
    }

    case 'custom':
      return current[field.key]

    case 'color': {
      // A #rrggbb hex, which the page writes straight into CSS — anything else
      // leaves the setting as it was.
      return normalizeColor((formData.get(field.key) as string) ?? '') ?? current[field.key]
    }

    case 'select': {
      // Only one of the offered options. Anything else — a crafted request —
      // leaves the setting as it was rather than storing a value no renderer
      // was written to expect.
      return normalizeSelect(field, (formData.get(field.key) as string) ?? '') ?? current[field.key]
    }

    default:
      return normalizeText((formData.get(field.key) as string) ?? '')
  }
}

/**
 * WHICH SIZE THIS PANEL WAS EDITING.
 *
 * The editor puts it in the form (`__device`) because the same panel edits
 * every size, one at a time, and a value typed while the phone was selected
 * must not land on the desktop's key. Anything unrecognised — an old client,
 * a crafted request — reads as the base device, which is the safe direction:
 * it writes where it always did.
 */
export function formDevice(formData: FormData): Device {
  const raw = formData.get('__device')
  return typeof raw === 'string' && (DEVICES as readonly string[]).includes(raw)
    ? (raw as Device)
    : BASE_DEVICE
}

/** Every field of a section, read back out of its submitted panel. */
export function readSettingsFromForm(
  def: SectionDef,
  formData: FormData,
  current: SectionSettings
): SectionSettings {
  const next: SectionSettings = { ...current }
  const device = formDevice(formData)
  /*
   * The panel drew what this SIZE resolves to — the desktop's value showing
   * through wherever the phone has none of its own — so that is what a field
   * left untouched has to read back as. Handing it the raw settings would
   * make every unedited phone field look like a change from the desktop
   * value to nothing.
   */
  const seen = deviceView(def, current, device)

  for (const field of def.fields) {
    // A custom field is edited elsewhere; the generic panel never draws it and
    // this must not blank it.
    if (field.kind === 'custom') continue
    const value = readField(field, formData, seen)

    if (!field.device || device === BASE_DEVICE) {
      next[field.key] = value
      continue
    }

    /*
     * ONLY THE DIFFERENCE IS STORED.
     *
     * The panel shows the effective value, so most of what comes back on a
     * phone is the desktop's own value showing through. Writing that down
     * would freeze it: change the desktop photograph afterwards and the phone
     * would keep the old one, having copied it the moment anything else in
     * the panel was touched. Equal to the desktop means FOLLOWING, which is
     * also what makes "set it back and it follows again" true with no extra
     * control to find.
     */
    next[deviceKey(field.key, device)] = overrideValue(current[field.key], value)
  }

  return next
}
