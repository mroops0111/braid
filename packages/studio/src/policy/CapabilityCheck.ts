import type { Capability } from '@braidhq/schema'
import type { ViewerContext } from './ViewerContext'

export interface CapabilityCheck {
  readonly id: Capability
  evaluate: (viewer: ViewerContext) => boolean
}
