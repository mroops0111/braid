import type { Capability } from './Capability.js'
import type { CapabilityCheck } from './CapabilityCheck.js'
import type { ViewerContext } from './ViewerContext.js'

/**
 * Open registry of capability strategies. Adding a new capability =
 * `registry.register(new MyCheck())`; existing checks are untouched.
 *
 * Unknown capability ids resolve to `false` (default deny). This makes
 * it safe to typo a capability id; the call denies instead of
 * accidentally allowing.
 */
export class PermissionRegistry {
  private readonly checks = new Map<Capability, CapabilityCheck>()

  register(check: CapabilityCheck): this {
    this.checks.set(check.id, check)
    return this
  }

  has(capability: Capability): boolean {
    return this.checks.has(capability)
  }

  /**
   * Decide whether a viewer can perform a capability. The viewer
   * already carries its own resource (e.g. skill for skill.run); the
   * caller is responsible for building the right viewer.
   */
  can(capability: Capability, viewer: ViewerContext): boolean {
    return this.checks.get(capability)?.evaluate(viewer) ?? false
  }
}
