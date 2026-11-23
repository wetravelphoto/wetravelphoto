/**
 * THE FAKE DATABASE `.mk/picker-editor.ts` RUNS THE EDITOR'S READS AGAINST
 * ═══════════════════════════════════════════════════════════════════════
 *
 * A PostgREST-shaped builder over plain rows that applies EXACTLY the filters
 * the code under test writes — no row-level security. That is how a platform
 * admin is answered (RLS lets them see every site), so a query that forgets
 * its `tenant_id` filter returns another site's rows here, as it would there.
 *
 * Every query is logged (table + operations) so the suite can assert which
 * filters each one carried. Only the operations lib/photos/library.ts and the
 * actions use are implemented; anything else throws, so a new query shape is
 * noticed rather than silently mis-answered.
 *
 * `prove` stands in for read_photo_render_assets (the candidate migration
 * 2026-10-07_photo_render_read.sql), modelled rule for rule: as a SECURITY
 * DEFINER function it sees every site's albums, which is exactly what lets it
 * refuse a key naming another site's album that RLS would hide. The real
 * function is exercised by .mk/picker-editor-db.ts; this model is only for
 * the unit half. NOT NULL column defaults are applied on read (`exif` is
 * `not null default '{}'`), so a row written without them reads as the
 * database would hold it.
 */

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { isNonBlankText, renderFile, type RefOutcome, type RenderAsset, type RenderRef } from '@/lib/photos/image'
import { parseLegacyKey } from '@/lib/photos/legacy-key'

export type Row = Record<string, unknown>
export type Logged = { table: string; ops: string[]; mode: 'select' | 'update' | 'delete' }

type Order = { column: string; ascending: boolean }

export class FakeDb {
  tables: Record<string, Row[]> = {}
  log: Logged[] = []
  /** Tables whose next read fails, as a PostgREST error. */
  failing = new Set<string>()
  updates: Array<{ table: string; values: Row; ops: string[] }> = []
  deletes: Array<{ table: string; rows: Row[]; ops: string[] }> = []
  /** Every proof call: the site and the references, as sent. */
  proofs: Array<{ tenantId: string; refs: RenderRef[] }> = []
  /** While set, every proof rejects (a failed call or a refused reply). */
  proofFails = false

  from(table: string) {
    return new FakeQuery(this, table)
  }

  prove = async (tenantId: string, refs: readonly RenderRef[]): Promise<RefOutcome[]> => {
    this.proofs.push({ tenantId, refs: [...refs] })
    if (this.proofFails) throw new Error('fake: proof failed')
    if (refs.length > 200) throw new Error('fake: more than 200 references in one call')
    return refs.map((r) => fakeRead(this.tables, tenantId, r))
  }

  /** Service-role RPC calls made through `serviceClient()`. */
  rpcCalls: Array<{ fn: string; tenantId: string; refs: unknown[] }> = []

  /**
   * A service-role client whose only method answers read_photo_render_assets
   * in the function's own WIRE shape (`{ v, results, assets }`), so the real
   * lib/photos/editor-proof.ts and the foundation's reply parser run on it.
   */
  serviceClient() {
    return {
      rpc: async (fn: string, args: { p_tenant: string; p_refs: unknown[] }) => {
        this.rpcCalls.push({ fn, tenantId: args.p_tenant, refs: args.p_refs })
        if (fn !== 'read_photo_render_assets') return { data: null, error: { message: `fake: no function ${fn}` } }
        if (this.proofFails) return { data: null, error: { message: 'fake: proof failed' } }
        const results: unknown[] = []
        const assets: Record<string, unknown> = {}
        for (const w of args.p_refs as Array<{ asset_id?: string; path?: string }>) {
          const ref = (w.asset_id !== undefined ? { assetId: w.asset_id, path: w.path ?? null } : { assetId: null, path: w.path! }) as RenderRef
          const o = fakeRead(this.tables, args.p_tenant, ref)
          if (o.outcome === 'ok') {
            results.push({ outcome: 'ok', asset_id: o.asset.id })
            assets[o.asset.id] = {
              id: o.asset.id,
              display_path: o.asset.displayPath,
              derivatives: o.asset.derivatives,
              width: o.asset.dimensions?.width ?? null,
              height: o.asset.dimensions?.height ?? null,
              alt_text: o.asset.alt,
            }
          } else if (o.outcome === 'unavailable') results.push({ outcome: 'unavailable', reason: o.reason })
          else results.push({ outcome: o.outcome })
        }
        return { data: { v: 1, results, assets }, error: null }
      },
    }
  }
}

const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIZE_KEYS = ['400', '800', '1600', '2400']

/** read_photo_render_assets, one reference, modelled on the candidate SQL. */
function fakeRead(tables: Record<string, Row[]>, tenantId: string, ref: RenderRef): RefOutcome {
  const assets = tables.photo_assets ?? []
  if (ref.assetId !== null && !UUID_ANY.test(ref.assetId)) return { outcome: 'invalid' }
  if (ref.path !== null && renderFile(ref.path) === null) return { outcome: 'invalid' }
  const claimed = (a: Row) => {
    const out = new Set<string>([String(a.display_path)])
    const d = a.derivatives
    if (d && typeof d === 'object' && !Array.isArray(d)) for (const v of Object.values(d as Row)) if (typeof v === 'string') out.add(v)
    return out
  }
  let a: Row | undefined
  if (ref.assetId !== null) {
    const id = ref.assetId.toLowerCase()
    a = assets.find((x) => x.id === id && x.tenant_id === tenantId)
    if (!a) return { outcome: 'missing' }
    if (ref.path !== null && !claimed(a).has(ref.path)) return { outcome: 'mismatch' }
  } else {
    const path = ref.path!
    const folder = path.slice(0, path.lastIndexOf('/'))
    const flat = path.endsWith('.jpg') ? path.slice(0, -4) : null
    const found = assets.filter((x) => x.tenant_id === tenantId && (x.key_base === folder || x.key_base === flat) && claimed(x).has(path))
    if (!found.length) return { outcome: 'missing' }
    if (found.length > 1) return { outcome: 'ambiguous' }
    a = found[0]!
  }
  if (a.deleted_at != null) return { outcome: 'unavailable', reason: 'deleted' }
  if (a.archived_at != null) return { outcome: 'unavailable', reason: 'archived' }
  if (a.state !== 'derived') return { outcome: 'unavailable', reason: a.state === 'pending' || a.state === 'failed' ? a.state : 'malformed' }

  const kb = String(a.key_base)
  const derivs: Record<string, string> = {}
  const raw = a.derivatives
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Row)) if (SIZE_KEYS.includes(k) && v === `${kb}/${k}.webp`) derivs[k] = v
  }
  const parsed = parseLegacyKey(kb)
  const grammar = parsed.ok && parsed.shape === 'base' && parsed.keyBase === kb
  const album = grammar && /^(photos|covers)\//.test(kb) ? kb.split('/')[1] : null
  // A definer function sees every site's albums — RLS hides nothing from it.
  const foreignAlbum = album !== null && (tables.albums ?? []).some((al) => al.id === album && al.tenant_id !== tenantId)
  const display = String(a.display_path)
  const flatDisplay = parseLegacyKey(display)
  const displayOk = (display === `${kb}.jpg` && flatDisplay.ok && flatDisplay.keyBase === kb) || Object.values(derivs).includes(display)
  const pathOk = ref.path === null || ref.path === display || Object.values(derivs).includes(ref.path)
  if (!grammar || (kb.startsWith('t/') && kb.split('/')[1] !== tenantId) || foreignAlbum || !displayOk || !pathOk) {
    return { outcome: 'unavailable', reason: 'malformed' }
  }

  // exif is NOT NULL DEFAULT '{}' in the real table.
  const exif = a.exif === undefined || a.exif === null ? {} : a.exif
  const isObject = !!exif && typeof exif === 'object' && !Array.isArray(exif)
  const o = isObject ? (exif as Row).orientation : undefined
  const upright = isObject && (o === undefined || (typeof o === 'number' && [1, 2, 3, 4].includes(o)))
  const side = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65535
  const trusted = a.derived_at != null && side(a.width) && side(a.height) && upright
  const alt = typeof a.alt_text === 'string' && a.alt_text.length <= 1000 && isNonBlankText(a.alt_text) ? a.alt_text : null
  const asset: RenderAsset = {
    id: String(a.id),
    displayPath: display,
    derivatives: derivs,
    dimensions: trusted ? { width: a.width as number, height: a.height as number } : null,
    alt,
  }
  return { outcome: 'ok', asset }
}

const KEYSET = /^created_at\.(lt|gt)\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.(lt|gt)\.([0-9a-f-]{36})\)$/

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private preds: Array<(r: Row) => boolean> = []
  private orders: Order[] = []
  private max: number | null = null
  private cols = '*'
  private single = false
  private entry: Logged
  private updateValues: Row | null = null
  private deleting = false

  constructor(private db: FakeDb, private table: string) {
    this.entry = { table, ops: [], mode: 'select' }
    db.log.push(this.entry)
  }

  private op(s: string) {
    this.entry.ops.push(s)
    return this
  }

  select(cols: string) {
    this.cols = cols
    return this.op(`select:${cols}`)
  }
  delete() {
    this.deleting = true
    this.entry.mode = 'delete'
    return this.op('delete')
  }
  update(values: Row) {
    this.updateValues = values
    this.entry.mode = 'update'
    return this.op('update')
  }
  eq(c: string, v: unknown) {
    this.preds.push((r) => r[c] === v)
    return this.op(`eq:${c}=${String(v)}`)
  }
  neq(c: string, v: unknown) {
    this.preds.push((r) => r[c] !== v)
    return this.op(`neq:${c}=${String(v)}`)
  }
  in(c: string, vs: readonly unknown[]) {
    this.preds.push((r) => vs.includes(r[c]))
    return this.op(`in:${c}=${vs.length}`)
  }
  is(c: string, v: null) {
    if (v !== null) throw new Error('fake: is() only with null')
    this.preds.push((r) => r[c] === null || r[c] === undefined)
    return this.op(`is:${c}=null`)
  }
  not(c: string, operator: string, v: unknown) {
    if (operator !== 'is' || v !== null) throw new Error('fake: not() only as not is null')
    this.preds.push((r) => r[c] !== null && r[c] !== undefined)
    return this.op(`not:${c}=null`)
  }
  filter(c: string, operator: string, v: unknown) {
    if (operator !== 'match' || typeof v !== 'string') throw new Error('fake: filter() only as match')
    const re = new RegExp(v)
    this.preds.push((r) => typeof r[c] === 'string' && re.test(r[c] as string))
    return this.op(`match:${c}=${v}`)
  }
  or(expr: string) {
    const m = KEYSET.exec(expr)
    if (!m) throw new Error(`fake: or() shape not understood: ${expr}`)
    const [, op1, c1, c2, op2, id] = m
    if (c1 !== c2 || op1 !== op2) throw new Error('fake: inconsistent keyset')
    const before = op1 === 'lt'
    this.preds.push((r) => {
      const c = String(r.created_at)
      if (c !== c1) return before ? c < c1 : c > c1
      return before ? String(r.id) < id : String(r.id) > id
    })
    return this.op(`or:keyset:${op1}`)
  }
  order(column: string, options: { ascending: boolean }) {
    this.orders.push({ column, ascending: options.ascending })
    return this.op(`order:${column}:${options.ascending ? 'asc' : 'desc'}`)
  }
  limit(n: number) {
    this.max = n
    return this.op(`limit:${n}`)
  }
  maybeSingle() {
    this.single = true
    return this.op('maybeSingle')
  }

  private run(): { data: unknown; error: { message: string } | null } {
    if (this.db.failing.has(this.table)) return { data: null, error: { message: 'fake: read failed' } }
    const all = this.db.tables[this.table] ?? []
    let rows = all.filter((r) => this.preds.every((p) => p(r)))
    if (this.deleting) {
      this.db.tables[this.table] = all.filter((r) => !rows.includes(r))
      this.db.deletes.push({ table: this.table, rows, ops: this.entry.ops })
      return { data: this.cols === '*' ? null : rows.map((r) => project(r, this.cols)), error: null }
    }
    if (this.updateValues) {
      for (const r of rows) Object.assign(r, this.updateValues)
      this.db.updates.push({ table: this.table, values: this.updateValues, ops: this.entry.ops })
      return { data: null, error: null }
    }
    if (this.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const o of this.orders) {
          // As PostgreSQL: numbers as numbers, and NULL after everything ascending (first descending).
          const u = a[o.column] ?? null
          const v = b[o.column] ?? null
          if (u === null || v === null) {
            if (u !== v) return (u === null ? 1 : -1) * (o.ascending ? 1 : -1)
            continue
          }
          const x = typeof u === 'number' ? u : String(u)
          const y = typeof v === 'number' ? v : String(v)
          if (x !== y) return (x < y ? -1 : 1) * (o.ascending ? 1 : -1)
        }
        return 0
      })
    }
    if (this.max !== null) rows = rows.slice(0, this.max)
    const projected = rows.map((r) => project(r, this.cols))
    if (this.single) return { data: projected[0] ?? null, error: null }
    return { data: projected, error: null }
  }

  then<A = { data: unknown; error: { message: string } | null }, B = never>(
    ok?: ((v: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    bad?: ((e: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, bad)
  }
}

/** Only the columns asked for — `alias:col->key` reads one JSON key. */
function project(r: Row, cols: string): Row {
  if (cols === '*') return { ...r }
  const out: Row = {}
  for (const raw of cols.split(',')) {
    const c = raw.trim()
    const alias = c.includes(':') ? c.slice(0, c.indexOf(':')) : null
    const expr = alias ? c.slice(alias.length + 1) : c
    if (expr.includes('->')) {
      const [col, key] = expr.split('->') as [string, string]
      const json = r[col]
      out[alias ?? key] = json && typeof json === 'object' ? ((json as Row)[key] ?? null) : null
    } else {
      out[alias ?? expr] = r[expr] ?? null
    }
  }
  return out
}

/**
 * A bundle directory of this run's own. Under node_modules (so a bundle's
 * external imports resolve), but unique per process and removed at exit: a
 * mutation run in a scratch copy reaches node_modules through a junction, and
 * a fixed path there would let its mutated bundle meet a real run's.
 */
export function bundleDir(): string {
  const dir = join(process.cwd(), 'node_modules/.cache/picker-editor', `${process.pid}-${randomBytes(4).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
  return dir
}
