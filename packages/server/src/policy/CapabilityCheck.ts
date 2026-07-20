import type { Capability } from '@braidhq/schema'
import type { ViewerContext } from './ViewerContext.js'

/**
 * The Strategy interface, where each capability owns its decision logic.
 * A stateless check is a const object, the first-party set lives in `checks.ts`.
 *
 * Implementations MUST be pure, with no I/O, clock, or randomness,
 * so the same viewer always produces the same answer.
 */
export interface CapabilityCheck {
  readonly id: Capability
  evaluate: (viewer: ViewerContext) => boolean
}
