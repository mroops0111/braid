import type { Capability } from '@braidhq/schema'
import type { CapabilityCheck } from './CapabilityCheck'
import type { ViewerContext } from './ViewerContext'

export class PermissionRegistry {
  private readonly checks = new Map<Capability, CapabilityCheck>()

  register(check: CapabilityCheck): this {
    this.checks.set(check.id, check)
    return this
  }

  has(capability: Capability): boolean {
    return this.checks.has(capability)
  }

  can(capability: Capability, viewer: ViewerContext): boolean {
    return this.checks.get(capability)?.evaluate(viewer) ?? false
  }
}
