import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'

/**
 * Re-apply the current viewport intent when the canvas changes width.
 *
 * Opening the detail panel narrows the canvas by a third,
 * and it opens as a result of the selection that also moved the viewport.
 * What was centred a moment earlier therefore sits off to one side,
 * and nothing re-runs, since the node set did not change again.
 *
 * The caller decides what to re-apply, because the intent differs.
 * A focused neighbourhood wants fitting, a selected node wants centring,
 * and refitting the second would throw away the position,
 * the reader just arrived at.
 *
 * Width alone, not height.
 * A banner appearing changes the height without moving anything sideways,
 * and reacting to that would tug the canvas out from under the reader.
 */
export function useRefitOnResize(
  containerRef: RefObject<HTMLElement | null>,
  reapply: () => void,
): void {
  const lastWidthRef = useRef<number | null>(null)
  // Held in a ref so a new callback identity does not tear down the observer,
  // and written in an effect rather than during render.
  const reapplyRef = useRef(reapply)
  useEffect(() => {
    reapplyRef.current = reapply
  }, [reapply])

  useEffect(() => {
    const element = containerRef.current
    if (!element)
      return
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0)
      if (width === 0)
        return
      const previous = lastWidthRef.current
      lastWidthRef.current = width
      // The first reading sets the baseline rather than re-applying,
      // since mount has already positioned the viewport.
      if (previous === null || previous === width)
        return
      reapplyRef.current()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [containerRef])
}
