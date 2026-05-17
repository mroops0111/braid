import type { Timestamp } from '@braidhq/schema'

/**
 * Test time anchor. The absolute value is **irrelevant** — tests only
 * care about relative ordering. Picked an arbitrary instant in 2024
 * because ISO formatters render it cleanly and the date is far enough
 * from the project's commit timestamps to be obviously a sentinel.
 *
 * Do not assert against this value. Use `at(seconds)` instead.
 */
const ANCHOR = new Date('2024-01-01T00:00:00.000Z')

/**
 * Returns a `Timestamp` `secondsFromAnchor` seconds after the test
 * time anchor. Reads naturally in test code:
 *
 * ```ts
 * const proposal = makeProposal({ generatedAt: at(0) })
 * const reviewed = proposal.markApplied(userId, at(60))   // 1 minute later
 * ```
 *
 * Negative offsets are allowed.
 */
export function at(secondsFromAnchor = 0): Timestamp {
  return new Date(ANCHOR.getTime() + secondsFromAnchor * 1000).toISOString() as Timestamp
}

/** Convenience: shorthand for `at(0)`. */
export const T0 = at()

/** Convenience: shorthand for `at(60)`. */
export const T_PLUS_1_MIN = at(60)

/** Convenience: shorthand for `at(3600)`. */
export const T_PLUS_1_HOUR = at(3600)
