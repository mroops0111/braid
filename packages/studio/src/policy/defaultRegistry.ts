import { checks } from './checks'
import { PermissionRegistry } from './PermissionRegistry'

export function buildDefaultPermissionRegistry(): PermissionRegistry {
  const registry = new PermissionRegistry()
  for (const check of checks)
    registry.register(check)
  return registry
}

export const defaultPermissionRegistry = buildDefaultPermissionRegistry()
