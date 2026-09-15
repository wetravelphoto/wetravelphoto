/**
 * THE ENTITLEMENT SEAM
 * ════════════════════
 *
 * There are no plans today. Every site gets everything. This file exists so
 * that the day plans do exist, adding them is a change to ONE function rather
 * than an audit of the whole codebase looking for places that should have
 * asked.
 *
 * So: anything that could conceivably be sold separately asks `can()` now,
 * even though the answer is always yes. A call site that reads
 *
 *     if (await can(tenantId, 'templates.premium')) { … }
 *
 * costs nothing while the answer is hardcoded, and is already in the right
 * shape when it is not.
 *
 * ── The rule that matters ───────────────────────────────────────────────────
 *
 * A PLAN MAY LOCK, IT MAY NOT DELETE.
 *
 * When someone drops to a smaller plan, or a trial ends, nothing they made is
 * removed. A section beyond their limit is hidden and marked locked. A premium
 * look they were using keeps rendering, or reverts to the last one they owned
 * — their own writing and photographs are never touched either way. Going back
 * up restores exactly what was there.
 *
 * That is not generosity, it is the only version that is safe to ship: a
 * downgrade that deletes is a bug report you cannot answer, and it is the one
 * mistake in this whole system that cannot be undone.
 */

/**
 * Everything that might one day depend on a plan. Add freely — an unknown
 * capability is not an error, it is just one nobody gates yet.
 */
export type Capability =
  /** Looks beyond the ones bundled with every site. */
  | 'templates.premium'
  /** Section types marked with a tier in lib/sections/registry.ts. */
  | 'sections.premium'
  /** Pages the photographer creates themselves, beyond the built-in set. */
  | 'pages.custom'
  /** Selling prints at all. */
  | 'shop.enabled'
  /** Taking the platform's mark off the footer. */
  | 'branding.remove'
  /** Password-protected client galleries. */
  | 'galleries.private'
  /** Pointing a bought domain at the site. */
  | 'domain.custom'

/**
 * Whether a site may use something.
 *
 * Always true. When plans arrive this reads the tenant's plan and its
 * overrides; nothing else in the codebase changes.
 */
export async function can(_tenantId: string | null, _capability: Capability): Promise<boolean> {
  return true
}

/**
 * The same question for a list, in one call — for a picker that has to mark
 * several things at once.
 */
export async function canAll(
  tenantId: string | null,
  capabilities: Capability[]
): Promise<Record<string, boolean>> {
  const answers = await Promise.all(capabilities.map((c) => can(tenantId, c)))
  return Object.fromEntries(capabilities.map((c, i) => [c, answers[i]]))
}

/**
 * Whether a tier string — on a template row, or on a section type — is
 * available to this site. `null` means it is part of every plan.
 */
export async function tierAllowed(
  tenantId: string | null,
  tier: string | null | undefined,
  capability: Capability
): Promise<boolean> {
  if (!tier) return true
  return can(tenantId, capability)
}

/**
 * Why something is locked, for the message beside it. Nothing is locked
 * today, so nothing calls this yet — it is here so the shape of "locked"
 * exists before the first thing is.
 */
export type Lock = {
  capability: Capability
  /** What the photographer sees. Never a dead end — say what unlocks it. */
  reason: string
}
