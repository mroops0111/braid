import { useEffect, useState } from 'react'

/**
 * Trails a value by a delay, so a per-keystroke change becomes one request.
 *
 * A vector query costs a model call, which on a local model runs into seconds,
 * so firing one per keystroke would make typing feel stuck.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}
