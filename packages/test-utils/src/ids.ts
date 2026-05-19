/**
 * Minted test IDs. Each call returns a fresh string with a stable
 * counter scoped to the prefix; restart per test by calling `reset()`
 * (typically from a `beforeEach`). The counter exists so failed tests
 * print readable ids (`p-1`, `p-2`) rather than UUIDs.
 *
 * Use these instead of `'p-1' as ProposalId` literals so a test can
 * mint as many ids as it needs without naming conflicts.
 */
const counters = new Map<string, number>()

export function mintTestId(prefix: string): string {
  const next = (counters.get(prefix) ?? 0) + 1
  counters.set(prefix, next)
  return `${prefix}-${next}`
}

/** Reset all minted-id counters. Call from `beforeEach` for deterministic test ids. */
export function resetTestIds(): void {
  counters.clear()
}
