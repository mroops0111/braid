import { checks } from './checks.js'
import { PermissionRegistry } from './PermissionRegistry.js'

/**
 * Default registry preloaded with the first-party capabilities.
 * Plugins register their own checks, calling `register()` on this instance.
 * Tests build a fresh `PermissionRegistry` instead, to inject mocks.
 */
export function buildDefaultPermissionRegistry(): PermissionRegistry {
  const registry = new PermissionRegistry()
  for (const check of checks)
    registry.register(check)
  return registry
}

export const defaultPermissionRegistry = buildDefaultPermissionRegistry()
