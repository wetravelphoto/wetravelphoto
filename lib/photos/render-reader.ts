import {
  RENDER_MAX_BYTES,
  RENDER_MAX_REFS,
  RenderReplyError,
  parseRenderReply,
  refIsWellFormed,
  refKey,
  toWire,
  type RefOutcome,
  type RenderRef,
  type ReplyFault,
} from '@/lib/photos/image'

/**
 * THE REQUEST-SCOPED READER OF CANONICAL PHOTOGRAPH METADATA
 * ══════════════════════════════════════════════════════════
 *
 * P5. One instance per request — `renderReader()` in lib/photos/public.ts
 * makes it, server-only, behind React's per-request `cache()`. It holds what
 * this request has already been told and nothing else: no module-level map,
 * no cross-request cache, so a canonical alt text written a moment ago is what
 * the next request reads.
 *
 * ── What may feed it ────────────────────────────────────────────────────────
 * The site is a `HostTenant` — resolved from the request's Host, never from a
 * session, a body or a parameter. Every batch of references comes with a
 * `SourceGrant` — a value only a source's own access gate mints, after it has
 * decided this visitor may see that source (a published page, a gallery past
 * its access check, a published story …). Both are branded types: a boolean,
 * a bare string or an object literal cannot stand in for either, and the only
 * casts that mint them live in lib/photos/public.ts (.mk/render-read.ts scans
 * for any other). The database separately constrains what it can answer to
 * this one site and the named references.
 *
 * ── Bounded, and deterministic ──────────────────────────────────────────────
 * At most RENDER_MAX_REFS (200) references a call and `maxCalls` calls a
 * request (default 5, so 1000 distinct references; any value given is made a
 * whole number from 0 to 20 — NaN, Infinity or a non-number is the default).
 * A reference is asked about ONCE per request: the first `resolve()` that
 * meets it starts the read and every later or concurrent one awaits the same
 * answer, so parallel renders of one page share their reads. Calls are
 * counted the moment they start, so concurrency cannot overspend the budget.
 *
 *   a reference the database would call invalid → `invalid`, never sent
 *   past the budget                              → `not_read`
 *   a failed call or a refused reply             → `error`, for that batch
 *
 * None of these is a "missing", none throws, and none is a fallback: what a
 * placement does with them is lib/photos/image.ts's decision (a claimed
 * identity that was not verified draws nothing).
 *
 * Logs carry the surface, counts and a fixed reason (`ReadFault`) — never a
 * path, an id, alt text, anything the reply contained, or the message of any
 * error, the database's included.
 */

declare const hostTenantBrand: unique symbol
declare const sourceGrantBrand: unique symbol

/** The request's site, from its Host. Minted only by lib/photos/public.ts. */
export type HostTenant = { readonly tenantId: string; readonly [hostTenantBrand]: true }

/** The surfaces a grant can name. Each gets its gate in the integration unit. */
export type SourceKind =
  | 'live_page'
  | 'page_preview'
  | 'gallery'
  | 'gallery_share'
  | 'story'
  | 'story_preview'
  | 'shop'
  | 'page_metadata'

/** Proof that a source's own gate admitted this request. Minted only by lib/photos/public.ts. */
export type SourceGrant = {
  readonly tenantId: string
  readonly source: SourceKind
  readonly [sourceGrantBrand]: true
}

type RpcResult = { data: unknown; error: { message: string } | null }

/** What the reader asks of the database. The service-role client is one. */
export type RenderRpc = {
  rpc(fn: 'read_photo_render_assets', args: { p_tenant: string; p_refs: unknown[] }): PromiseLike<RpcResult>
}

export type ReaderOptions = {
  maxCalls?: number
  log?: Pick<Console, 'warn' | 'error'>
}

export const DEFAULT_MAX_CALLS = 5
/** No option can raise a request's budget past this. */
export const MAX_CALLS_CEILING = 20

/** Any `maxCalls` → a whole number of calls from 0 to the ceiling. */
export function normalizeMaxCalls(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_MAX_CALLS
  return Math.min(MAX_CALLS_CEILING, Math.max(0, Math.floor(v)))
}

const NOT_READ: RefOutcome = Object.freeze({ outcome: 'not_read' })
const ERROR: RefOutcome = Object.freeze({ outcome: 'error' })
const INVALID: RefOutcome = Object.freeze({ outcome: 'invalid' })

export class RenderAssetReader {
  readonly #tenant: HostTenant
  readonly #rpc: RenderRpc
  readonly #maxCalls: number
  readonly #log: Pick<Console, 'warn' | 'error'>
  /** Every reference this request has met → its answer, settled or in flight. */
  readonly #known = new Map<string, Promise<RefOutcome>>()
  #calls = 0

  constructor(tenant: HostTenant, rpc: RenderRpc, options: ReaderOptions = {}) {
    this.#tenant = tenant
    this.#rpc = rpc
    this.#maxCalls = normalizeMaxCalls(options.maxCalls)
    this.#log = options.log ?? console
  }

  /** Calls made (started) so far in this request. */
  get calls(): number {
    return this.#calls
  }

  /** This request's budget, as normalised. */
  get maxCalls(): number {
    return this.#maxCalls
  }

  /**
   * One outcome per reference, in order. The grant must be for this reader's
   * site; one minted for another site answers `error` for everything and asks
   * nothing. Never rejects.
   */
  resolve(grant: SourceGrant, refs: readonly RenderRef[]): Promise<RefOutcome[]> {
    if (grant.tenantId !== this.#tenant.tenantId) {
      this.#log.error('[photos] a source grant for another site was refused', { source: sourceOf(grant) })
      return Promise.resolve(refs.map(() => ERROR))
    }

    // Everything up to the first await is synchronous: a concurrent resolve()
    // sees every reference this one claimed, and every call it counted.
    const fresh: RenderRef[] = []
    const settle = new Map<string, (o: RefOutcome) => void>()
    for (const r of refs) {
      const k = refKey(r)
      if (this.#known.has(k)) continue
      if (!refIsWellFormed(r)) {
        this.#known.set(k, Promise.resolve(INVALID))
        continue
      }
      this.#known.set(k, new Promise<RefOutcome>((done) => settle.set(k, done)))
      fresh.push(r)
    }

    const reads: Promise<void>[] = []
    for (let at = 0; at < fresh.length; at += RENDER_MAX_REFS) {
      const batch = fresh.slice(at, at + RENDER_MAX_REFS)
      if (this.#calls >= this.#maxCalls) {
        this.#log.warn("[photos] the request's metadata budget is spent", { source: sourceOf(grant), unread: fresh.length - at })
        for (const r of fresh.slice(at)) settle.get(refKey(r))!(NOT_READ)
        break
      }
      this.#calls++
      reads.push(this.#read(grant, batch, settle))
    }

    return Promise.all(reads).then(() => Promise.all(refs.map((r) => this.#known.get(refKey(r))!)))
  }

  async #read(grant: SourceGrant, batch: RenderRef[], settle: Map<string, (o: RefOutcome) => void>): Promise<void> {
    let outcomes: RefOutcome[] | null = null
    let reason: ReadFault = 'unexpected'
    try {
      const wire = batch.map(toWire)
      // jsonb's text adds a space after each `:` and `,`; allow for it.
      if (new TextEncoder().encode(JSON.stringify(wire)).length + 4 * wire.length > RENDER_MAX_BYTES) {
        reason = 'batch_too_large'
      } else {
        reason = 'rpc_threw'
        const reply = await this.#rpc.rpc('read_photo_render_assets', { p_tenant: this.#tenant.tenantId, p_refs: wire })
        if (reply === null || typeof reply !== 'object' || reply.error) {
          reason = 'rpc_failed'
        } else {
          reason = 'reply_unreadable'
          outcomes = parseRenderReply(reply.data, batch, this.#tenant.tenantId)
        }
      }
    } catch (e) {
      // Classified, never quoted: whatever a provider, a driver or a reply put
      // in a message (a path, an id, alt text, a credential) stays out of the
      // log. A refused reply keeps its fault only if it is one of the known.
      if (e instanceof RenderReplyError && isReplyFault(e.fault)) reason = `reply ${e.fault}`
    }
    if (outcomes === null) {
      this.#log.error('[photos] canonical metadata could not be read', { source: sourceOf(grant), refs: batch.length, reason })
      outcomes = batch.map(() => ERROR)
    }
    batch.forEach((r, i) => settle.get(refKey(r))!(outcomes[i]!))
  }
}

/**
 * Every refusal lib/photos/image.ts can name — a Record, so a fault added
 * there does not compile here until it is listed. A fault not in it is
 * logged as `reply_unreadable`.
 */
const REPLY_FAULTS: Record<ReplyFault, true> = {
  shape: true, too_large: true, answer_count: true, asset_count: true,
  asset_shape: true, asset_id: true, display_path: true, derivatives: true, foreign_key: true,
  dimensions: true, alt_text: true,
  answer_shape: true, answer_unknown: true, answer_unbound: true, answer_impossible: true, asset_unasked: true,
}
const isReplyFault = (f: unknown): f is ReplyFault => typeof f === 'string' && Object.hasOwn(REPLY_FAULTS, f)

/**
 * The whole vocabulary of a failed read's log line. Nothing else is ever
 * logged as its reason — never a message taken from an error.
 */
export type ReadFault =
  | 'batch_too_large' // the batch would exceed the database's byte ceiling; not sent
  | 'rpc_threw' // the call threw or rejected
  | 'rpc_failed' // the call answered with an error (or with no reply at all)
  | 'reply_unreadable' // the reply was refused for a reason outside REPLY_FAULTS
  | `reply ${ReplyFault}` // the reply was refused, by its fixed fault
  | 'unexpected' // anything else, before the call was made

export const READ_FAULTS: readonly ReadFault[] = [
  'batch_too_large', 'rpc_threw', 'rpc_failed', 'reply_unreadable', 'unexpected',
  ...(Object.keys(REPLY_FAULTS) as ReplyFault[]).map((f) => `reply ${f}` as const),
]

const SOURCE_KINDS: readonly SourceKind[] = [
  'live_page', 'page_preview', 'gallery', 'gallery_share', 'story', 'story_preview', 'shop', 'page_metadata',
]
/** A grant's source as logged: one of the declared kinds, or `unknown`. */
const sourceOf = (grant: SourceGrant): SourceKind | 'unknown' =>
  (SOURCE_KINDS as readonly unknown[]).includes(grant.source) ? grant.source : 'unknown'
