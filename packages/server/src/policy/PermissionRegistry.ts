import type { Capability } from '@braidhq/schema'
import type { CapabilityCheck } from './CapabilityCheck.js'
import type { ViewerContext } from './ViewerContext.js'

/**
 * Open registry of capability strategies.
 * A new capability arrives via `registry.register(new MyCheck())`,
 * leaving existing checks untouched.
 *
 * Unknown capability ids resolve to `false`, a default deny.
 * This makes a typo'd capability id safe,
 * since the call denies rather than accidentally allowing.
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
   * Decide whether a viewer can perform a capability.
   * The viewer already carries its own resource,
   * such as the skill for skill.run,
   * so the caller is responsible for building the right viewer.
   */
  can(capability: Capability, viewer: ViewerContext): boolean {
    return this.checks.get(capability)?.evaluate(viewer) ?? false
  }
}
