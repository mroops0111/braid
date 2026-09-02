import type { Node, ReactFlowInstance } from '@xyflow/react'
import { useEffect, useMemo, useRef } from 'react'

/**
 * Re-fit the ReactFlow viewport whenever the laid-out node set changes.
 * Tracks a sorted-id key,
 * so unrelated re-renders do not trigger a fit,
 * such as selection, diff state, or edge highlights.
 * The very first render is skipped,
 * because ReactFlow's own `fitView` prop handles the mount case.
 */
export interface FitOnLayoutChangeOptions {
  duration?: number
  padding?: number
  /**
   * Handed the same framing that just ran,
   * so a caller can repeat it when the canvas changes size.
   */
  onFitted?: (refit: () => void) => void
}

export function useFitOnLayoutChange<T extends Record<string, unknown>>(
  reactFlow: ReactFlowInstance<Node<T>>,
  laidOutNodes: readonly Node<T>[],
  options: FitOnLayoutChangeOptions = {},
): void {
  const { duration = 250, padding = 0.15, onFitted } = options
  const fitKey = useMemo(() => laidOutNodes.map(n => n.id).sort().join('|'), [laidOutNodes])
  const lastFitKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastFitKeyRef.current === null) {
      lastFitKeyRef.current = fitKey
      return
    }
    if (lastFitKeyRef.current === fitKey)
      return
    lastFitKeyRef.current = fitKey
    if (laidOutNodes.length === 0)
      return
    const refit = (): void => {
      reactFlow.fitView({ duration, padding })
    }
    refit()
    // Hand the caller the same framing, so a later resize can repeat it.
    onFitted?.(refit)
  }, [fitKey, reactFlow, laidOutNodes.length, duration, padding, onFitted])
}
