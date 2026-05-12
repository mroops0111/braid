import type { Timestamp } from '@telos/schema'
import type { Clock } from '../domain/Clock.js'

export class SystemClock implements Clock {
  now(): Timestamp {
    return new Date().toISOString() as Timestamp
  }
}
