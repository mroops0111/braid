// Minted test ids, each a fresh string from a per-prefix counter.
// Reset the counters per test via resetTestIds() in a beforeEach.
// The counter keeps failed-test output readable,
// printing p-1 and p-2 rather than UUIDs.
// Prefer these over `'p-1' as ProposalId` literals,
// so a test can mint as many ids as it needs without conflicts.
const counters = new Map<string, number>()

export function mintTestId(prefix: string): string {
  const next = (counters.get(prefix) ?? 0) + 1
  counters.set(prefix, next)
  return `${prefix}-${next}`
}

/** Reset all minted-id counters. Call from a beforeEach for deterministic ids. */
export function resetTestIds(): void {
  counters.clear()
}
