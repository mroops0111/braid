import { useCallback, useState } from 'react'

/**
 * Controlled-or-uncontrolled state primitive.
 *
 * When the caller passes both `value` and `onChange`,
 * the component defers ownership to them.
 * When either is omitted, the component keeps the value in local state.
 * The setter signature stays the same in both modes,
 * so call sites do not branch.
 *
 * Use this when a component supports both modes,
 * such as a selection shared across sibling views, or used standalone,
 * to avoid the `isControlled ? onChange!(next) : setInternal(next)` boilerplate.
 */
export function useControllableState<T>(
  controlledValue: T | undefined,
  onControlledChange: ((next: T) => void) | undefined,
  defaultValue: T,
): readonly [T, (next: T) => void] {
  const [internal, setInternal] = useState<T>(defaultValue)
  const isControlled = controlledValue !== undefined && onControlledChange !== undefined
  const value = isControlled ? controlledValue : internal
  const setValue = useCallback(
    (next: T) => {
      if (isControlled)
        onControlledChange(next)
      else
        setInternal(next)
    },
    [isControlled, onControlledChange],
  )
  return [value, setValue]
}
