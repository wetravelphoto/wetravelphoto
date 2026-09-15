'use client'

import { useState } from 'react'
import Toggle from '@/components/admin/Toggle'
import PageImagePicker from '@/components/admin/PageImagePicker'
import {
  visibleFields,
  type Field,
  type SectionDef,
  type SectionSettings,
} from '@/lib/sections/registry'

/**
 * Draws a section's settings from its field declarations.
 *
 * There is no per-section form code anywhere: this reads the registry, and
 * app/actions/sections.ts reads the same declarations to put the values back.
 * A new section type gets a working settings panel for free, and a new setting
 * on an existing type is one line in `fields`.
 *
 * Every drawn field carries a hidden `__present_` marker so the save action can
 * tell "switched off" from "not on the page" — otherwise a field hidden by its
 * `when` would be wiped on every save.
 */
export default function SectionFields({
  def,
  settings,
  publicUrl,
}: {
  def: SectionDef
  settings: SectionSettings
  publicUrl: string
}) {
  // Kept in state so a `when` condition re-evaluates as you change the field
  // it depends on, instead of after a save.
  const [values, setValues] = useState<SectionSettings>(settings)
  const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }))

  const fields = visibleFields(def, values)

  const groups: { name: string | null; fields: Field[] }[] = []
  for (const field of fields) {
    const name = field.group ?? null
    const last = groups[groups.length - 1]
    if (last && last.name === name) last.fields.push(field)
    else groups.push({ name, fields: [field] })
  }

  return (
    <div className="sec-fields">
      {groups.map((group, i) => (
        <div key={group.name ?? `g${i}`} className="sec-group">
          {group.name && <p className="sec-group-name">{group.name}</p>}

          {group.fields.map((field) => (
            <div key={field.key} className="sec-field">
              <input type="hidden" name={`__present_${field.key}`} value="1" />
              {renderField(field, values, set, publicUrl)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function renderField(
  field: Field,
  values: SectionSettings,
  set: (key: string, value: unknown) => void,
  publicUrl: string
) {
  const value = values[field.key]

  switch (field.kind) {
    case 'toggle':
      return (
        <Toggle
          name={field.key}
          label={field.label}
          note={field.help}
          defaultChecked={value !== false}
          onChange={(v) => set(field.key, v)}
        />
      )

    case 'textarea':
      return (
        <label className="admin-field">
          {field.label}
          <textarea
            name={field.key}
            rows={field.rows ?? 4}
            placeholder={field.placeholder}
            defaultValue={(value as string) ?? ''}
          />
          {field.help && <span className="admin-meta">{field.help}</span>}
        </label>
      )

    case 'select':
      return (
        <label className="admin-field">
          {field.label}
          <select
            name={field.key}
            value={(value as string) ?? field.options[0]?.value}
            onChange={(e) => set(field.key, e.target.value)}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {field.help && <span className="admin-meta">{field.help}</span>}
        </label>
      )

    case 'number':
      return (
        <label className="admin-field">
          {field.label}
          <input
            type="number"
            name={field.key}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            defaultValue={typeof value === 'number' ? value : ''}
          />
          {field.help && <span className="admin-meta">{field.help}</span>}
        </label>
      )

    case 'image':
      return (
        <PageImagePicker
          name={field.key}
          label={field.label}
          initialPath={(value as string) ?? null}
          publicUrl={publicUrl}
          note={field.help}
        />
      )

    case 'custom':
      return (
        <div className="sec-custom">
          <span className="sec-custom-label">{field.label}</span>
          <span className="admin-meta">{field.note}</span>
        </div>
      )

    default:
      return (
        <label className="admin-field">
          {field.label}
          <input
            type="text"
            name={field.key}
            placeholder={'placeholder' in field ? field.placeholder : undefined}
            defaultValue={(value as string) ?? ''}
          />
          {field.help && <span className="admin-meta">{field.help}</span>}
        </label>
      )
  }
}
