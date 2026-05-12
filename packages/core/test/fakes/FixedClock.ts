import type { Timestamp } from '@telos/schema'
import type { Clock } from '../../src/index.js'

export class FixedClock implements Clock {
  constructor(private value: Timestamp) {}

  now(): Timestamp {
    return this.value
  }

  set(next: Timestamp): void {
    this.value = next
  }
}
