import type { Node, ReactFlowInstance } from '@xyflow/react'
import { useEffect, useMemo, useRef } from 'react'

/**
 * Re-fit the ReactFlow viewport whenever the laid-out node set
 * changes. Tracks a sorted-id key so unrelated re-renders (selection,
 * diff state, edge highlights) don't trigger a fit. The very first
 * render is skipped because ReactFlow's own `fitView` prop handles
 * the mount case.
 */
export function useFitOnLayoutChange<T extends Record<string, unknown>>(
  reactFlow: ReactFlowInstance<Node<T>>,
  laidOutNodes: readonly Node<T>[],
  duration = 250,
  padding = 0.15,
): void {
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
    if (laidOutNodes.length > 0)
      reactFlow.fitView({ duration, padding })
  }, [fitKey, reactFlow, laidOutNodes.length, duration, padding])
}
