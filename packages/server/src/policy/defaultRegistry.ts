import { checks } from './checks.js'
import { PermissionRegistry } from './PermissionRegistry.js'

/**
 * Default registry preloaded with the platform's first-party
 * capabilities. Plugins that want to register their own checks should
 * call `register()` on this instance; tests can build a fresh registry
 * via `new PermissionRegistry()` to inject mocks.
 */
export function buildDefaultPermissionRegistry(): PermissionRegistry {
  const registry = new PermissionRegistry()
  for (const check of checks)
    registry.register(check)
  return registry
}

export const defaultPermissionRegistry = buildDefaultPermissionRegistry()
