import type { Timestamp } from '@telos/schema'

export interface Clock {
  now: () => Timestamp
}
