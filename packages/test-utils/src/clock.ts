import type { Clock } from '@braidhq/core'
import type { Timestamp } from '@braidhq/schema'
import { T0 } from './time.js'

/**
 * Mutable Clock for tests that exercise time-dependent behaviour,
 * such as reviewedAt stamps or commit timestamps.
 * Defaults to the anchor T0. Change it via set() mid-test,
 * to assert a service used the injected timestamp, not Date.now().
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
