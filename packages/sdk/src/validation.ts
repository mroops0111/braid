import { ConflictError, ValidationError } from '@braidhq/core'

/**
 * SDK-internal builder-time assertions.
 * They run when a plugin author calls a `define*` factory,
 * before the plugin reaches the registry.
 * Failing here gives a stack trace at the offending line in plugin code,
 * which is more actionable than a runtime ConflictError,
 * thrown later from `PluginRegistry.register`.
 */

export function assertNoDuplicateIds(label: string, ids: readonly string[]): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id))
      throw new ConflictError(`${label}: duplicate id "${id}"`)
    seen.add(id)
  }
}

export function assertEndpointsResolve(
  label: string,
  endpoints: readonly string[],
  knownNodeTypeIds: ReadonlySet<string>,
): void {
  for (const endpoint of endpoints) {
    if (!knownNodeTypeIds.has(endpoint))
      throw new ValidationError(`${label}: references unknown node type "${endpoint}"`)
  }
}

/**
 * Permissive CSS colour check.
 * We accept the forms Studio renders without surprises,
 * `oklch(...)`, `oklab(...)`, `#xxx` or `#xxxxxx`,
 * `rgb(...)` or `rgba(...)`, and `hsl(...)` or `hsla(...)`.
 * Named CSS colours are intentionally rejected,
 * so a plugin author does not ship `"red"`,
 * then find Studio's dark theme has no contrast token for it.
 */
const COLOR_PATTERN = /^(?:oklch|oklab|rgb|rgba|hsl|hsla)\([^)]+\)$|^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export function assertColorString(label: string, color: string): void {
  if (!COLOR_PATTERN.test(color.trim()))
    throw new ValidationError(`${label}: "${color}" is not a recognised CSS colour function or hex literal`)
}

export function assertNonEmpty(label: string, value: string | undefined): void {
  if (!value || value.trim() === '')
    throw new ValidationError(`${label} must be a non-empty string`)
}
