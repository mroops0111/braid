/**
 * Parse a boolean env var. Canonical form is `true` or `false`.
 * We also accept the common YAML and shell idioms (`yes`/`no`, `on`/`off`, `1`/`0`),
 * so existing `.env` files don't break on the rename.
 *
 * Returns `defaultValue` when the variable is unset or the literal is unrecognised.
 * This silent fall-through keeps a typo in env from crashing the server boot.
 */
export function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined)
    return defaultValue
  const lower = value.trim().toLowerCase()
  if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on')
    return true
  if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off')
    return false
  return defaultValue
}
