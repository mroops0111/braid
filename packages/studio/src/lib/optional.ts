/**
 * Build a partial-prop object where `undefined` keys are stripped.
 * Use it to satisfy `exactOptionalPropertyTypes` without the verbose
 * `{...(value !== undefined ? { key: value } : {})}` JSX dance:
 *
 *   <Foo {...optional({ source, focusMode })} />
 *
 * Both `undefined` and never-set keys end up identical after the
 * spread, which is what TS's `exactOptionalPropertyTypes: true`
 * actually wants.
 */
export function optional<T extends Record<string, unknown>>(values: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined)
      (out as Record<string, unknown>)[key] = value
  }
  return out
}
