import { useCallback, useState } from 'react'

/**
 * Two pieces of state that must never both be non-null at once,
 * such as graph node-vs-edge selection.
 * Setting one to a non-null value clears the other,
 * and passing null leaves the partner untouched.
 */
export function useMutualExclusionPair<A, B>(
  initialA: A | null = null,
  initialB: B | null = null,
): [A | null, (value: A | null) => void, B | null, (value: B | null) => void] {
  const [a, setA] = useState<A | null>(initialA)
  const [b, setB] = useState<B | null>(initialB)
  const setExclusiveA = useCallback((value: A | null) => {
    setA(value)
    if (value !== null)
      setB(null)
  }, [])
  const setExclusiveB = useCallback((value: B | null) => {
    setB(value)
    if (value !== null)
      setA(null)
  }, [])
  return [a, setExclusiveA, b, setExclusiveB]
}
