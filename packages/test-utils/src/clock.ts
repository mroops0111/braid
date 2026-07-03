import type { Clock } from '@braidhq/core'
import type { Timestamp } from '@braidhq/schema'
import { T0 } from './time.js'

/**
 * Mutable `Clock` for tests that exercise time-dependent behaviour
 * (e.g. reviewedAt stamps, commit timestamps).
 *
 * Defaults to the test time anchor (`T0`); change via `set()` mid-test
 * to assert that the service captured the clock-injected timestamp
 * rather than `Date.now()`.
 */
export class FixedClock implements Clock {
  constructor(private current: Timestamp = T0) {}

  now(): Timestamp {
    return this.current
  }

  set(next: Timestamp): void {
    this.current = next
  }
}
