import type { Capability } from '@braidhq/schema'
import type { ViewerContext } from './ViewerContext.js'

/**
 * Each capability owns its decision logic in a single class. This is
 * the Strategy interface; concrete checks live under `./checks/`.
 *
 * Implementations MUST be pure (no I/O, no time, no rng) so the same
 * `(viewer)` always produces the same answer.
 */
export interface CapabilityCheck {
  readonly id: Capability
  evaluate: (viewer: ViewerContext) => boolean
}
