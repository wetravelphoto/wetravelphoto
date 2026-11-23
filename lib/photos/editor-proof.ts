import {
  RENDER_MAX_BYTES,
  RENDER_MAX_REFS,
  parseRenderReply,
  refIsWellFormed,
  toWire,
  type RefOutcome,
  type RenderRef,
} from '@/lib/photos/image'

/**
 * WHAT THE EDITOR'S PICKER MAY BELIEVE ABOUT A PHOTOGRAPH
 * ═══════════════════════════════════════════════════════
 *
 * P5. The editor reads its own site's rows through the photographer's client
 * (P1's authenticated SELECT, every query naming the site). That tells it
 * WHICH photographs exist; it cannot, by itself, tell whether one may be shown.
 * An unprefixed legacy key names an album, and row-level security hides
 * another site's private album from an ordinary photographer — so "no such
 * album" read through RLS could mean "deleted" or "somebody else's, hidden".
 * Only the canonical reader can tell those apart, and it is also the one place
 * that decides trusted dimensions and the canonical description.
 *
 * So once lib/photos/library.ts has read this site's rows, it asks
 * read_photo_render_assets (2026-10-07_photo_render_read.sql) about exactly
 * those asset ids, through the service role, for THIS site — the site
 * `requireEditor()` already authorised. Never a list the browser chose, never
 * another site, never more than RENDER_MAX_REFS a call; and every reply goes
 * through the foundation's own parser (lib/photos/image.ts), so the editor and
 * the public renderer believe exactly the same things about a photograph.
 *
 * No grant is added: the function is already the service role's, and the
 * service role still holds no privilege on photo_assets itself.
 */

/** One answer per reference, in order. Rejects on a failed call or a refused reply. */
export type AssetProof = (tenantId: string, refs: readonly RenderRef[]) => Promise<RefOutcome[]>

type RpcResult = { data: unknown; error: { message: string } | null }

/** The one method used of the service-role client. */
export type ProofRpc = {
  rpc(fn: 'read_photo_render_assets', args: { p_tenant: string; p_refs: unknown[] }): PromiseLike<RpcResult>
}

export class ProofError extends Error {
  constructor() {
    super('photographs could not be checked')
    this.name = 'ProofError'
  }
}

const INVALID: RefOutcome = Object.freeze({ outcome: 'invalid' })

/**
 * The proof, over a service-role client. A reference the database would call
 * invalid is answered so here and never sent. Any failure — the call, the
 * reply's shape — rejects the whole proof: the caller reports an error, never
 * a smaller library.
 */
export function renderProof(client: ProofRpc): AssetProof {
  return async (tenantId, refs) => {
    const out: RefOutcome[] = refs.map(() => INVALID)
    const asked: Array<{ at: number; ref: RenderRef }> = []
    refs.forEach((ref, at) => {
      if (refIsWellFormed(ref)) asked.push({ at, ref })
    })
    for (let i = 0; i < asked.length; i += RENDER_MAX_REFS) {
      const batch = asked.slice(i, i + RENDER_MAX_REFS)
      const wire = batch.map((b) => toWire(b.ref))
      if (new TextEncoder().encode(JSON.stringify(wire)).length + 4 * wire.length > RENDER_MAX_BYTES) throw new ProofError()
      let reply: RpcResult
      try {
        reply = await client.rpc('read_photo_render_assets', { p_tenant: tenantId, p_refs: wire })
      } catch {
        throw new ProofError()
      }
      if (reply.error) throw new ProofError()
      let answers: RefOutcome[]
      try {
        answers = parseRenderReply(reply.data, batch.map((b) => b.ref), tenantId)
      } catch {
        throw new ProofError()
      }
      batch.forEach((b, k) => {
        out[b.at] = answers[k]!
      })
    }
    return out
  }
}
