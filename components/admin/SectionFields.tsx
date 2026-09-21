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
 * lib/sections/form.ts reads the same declarations to put the values back.
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
  renderCustom,
  collapsible = false,
}: {
  def: SectionDef
  settings: SectionSettings
  publicUrl: string
  /**
   * Draws a `custom` field for real, where a caller has an editor for it.
   * The old admin forms pass nothing and keep showing the field's note, which
   * is what they have always done; the canvas passes a renderer. Returning
   * null falls back to the note, so an editor that does not exist yet degrades
   * to a description rather than a blank.
   */
  renderCustom?: (field: Field, value: unknown) => React.ReactNode | null
  /**
   * Groups fold away. The canvas turns this on; the old admin forms are short
   * enough not to need it and keep every group open.
   */
  collapsible?: boolean
}) {
  // Kept in state so a `when` condition re-evaluates as you change the field
  // it depends on, instead of after a save.
  const [values, setValues] = useState<SectionSettings>(settings)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }))

  const fields = visibleFields(def, values)

  /**
   * Fields grouped by their `group`, with the ungrouped ones gathered under a
   * name of their own.
   *
   * Most section types leave the main fields ungrouped — the hero's mode, title
   * and sub-heading have no `group` — which meant they drew no heading, so in
   * the canvas there was nothing to fold and the panel looked as though folding
   * had never been built. An unnamed group is still a group; it just needed a
   * name to be one.
   */
  const FIRST = 'Content'

  const groups: { name: string; fields: Field[] }[] = []
  for (const field of fields) {
    const name = field.group ?? FIRST
    const last = groups[groups.length - 1]
    if (last && last.name === name) last.fields.push(field)
    else groups.push({ name, fields: [field] })
  }

  const allKeys = groups.map((g, i) => `${g.name}-${i}`)
  const allShut = collapsible && allKeys.every((k) => folded.has(k))

  return (
    <div className="sec-fields">
      {collapsible && groups.length > 1 && (
        <button
          type="button"
          className="cv-fold-all"
          onClick={() => setFolded(allShut ? new Set() : new Set(allKeys))}
        >
          {allShut ? 'Expand all' : 'Collapse all'}
        </button>
      )}

      {groups.map((group, i) => {
        const key = `${group.name}-${i}`
        const shut = collapsible ? folded.has(key) : false

        return (
        <div key={key} className="sec-group">
          {collapsible ? (
              <button
                type="button"
                className="cv-fold"
                aria-expanded={!shut}
                onClick={() =>
                  setFolded((prev) => {
                    const next = new Set(prev)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })
                }
              >
                <span className="cv-fold-arrow" aria-hidden="true">
                  ▾
                </span>
                {group.name}
                {shut && <span className="cv-fold-count">{group.fields.length}</span>}
              </button>
          ) : (
            <p className="sec-group-name">{group.name}</p>
          )}

          {!shut &&
            group.fields.map((field) => (
            <div key={field.key} className="sec-field">
              <input type="hidden" name={`__present_${field.key}`} value="1" />
              {(field.kind === 'custom' && renderCustom?.(field, values[field.key])) ||
                renderField(field, values, set, publicUrl)}
            </div>
          ))}
        </div>
        )
      })}
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
      if (field.slider) {
        // Controlled, so the number beside the slider follows the thumb. The
        // save still reads the input by name like any other field.
        const current =
          typeof value === 'number' ? value : Number(value ?? field.min ?? 0) || (field.min ?? 0)
        return (
          <label className="admin-field">
            <span className="sec-slider-head">
              {field.label}
              <span className="sec-slider-value">
                {current}
                {field.unit ?? ''}
              </span>
            </span>
            <input
              type="range"
              name={field.key}
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              value={current}
              onChange={(e) => set(field.key, Number(e.target.value))}
            />
            {field.help && <span className="admin-meta">{field.help}</span>}
          </label>
        )
      }

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
