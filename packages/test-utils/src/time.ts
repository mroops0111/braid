import type { Timestamp } from '@braidhq/schema'

// Test time anchor. The absolute value is irrelevant,
// tests care only about relative ordering.
// Picked an arbitrary 2024 instant because ISO formatters render it cleanly,
// and it sits far from real commit timestamps as a sentinel.
// Do not assert against this value. Use at(seconds) instead.
const ANCHOR = new Date('2024-01-01T00:00:00.000Z')

/**
 * Returns a Timestamp secondsFromAnchor seconds after the anchor.
 * Reads naturally in tests, for example at(0) then at(60) a minute later.
 * Negative offsets are allowed.
 */
export function at(secondsFromAnchor = 0): Timestamp {
  return new Date(ANCHOR.getTime() + secondsFromAnchor * 1000).toISOString() as Timestamp
}

/** shorthand for at(0) */
export const T0 = at()

/** shorthand for at(60) */
export const T_PLUS_1_MIN = at(60)

/** shorthand for at(3600) */
export const T_PLUS_1_HOUR = at(3600)
