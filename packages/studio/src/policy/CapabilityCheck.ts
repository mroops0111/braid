import type { Capability } from './Capability'
import type { ViewerContext } from './ViewerContext'

export interface CapabilityCheck {
  readonly id: Capability
  evaluate: (viewer: ViewerContext) => boolean
}
