import type { Timestamp } from '@braidhq/schema'

export interface Clock {
  now: () => Timestamp
}
