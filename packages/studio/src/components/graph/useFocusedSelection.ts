import type { EdgeId, NodeId } from '@braidhq/schema'
import { useCallback, useState } from 'react'
import { useMutualExclusionPair } from '@/lib/useMutualExclusionPair'

/**
 * A graph selection, and whether the canvas is narrowed to its neighbourhood.
 *
 * The two are one value because focus frames a node,
 * so it ends when that node does. Left apart,
 * clearing a selection brings the whole graph back,
 * while the toggle still reads as pressed,
 * claiming a view nobody is looking at. Shared rather than repeated,
 * so the two surfaces cannot drift.
 */
export function useFocusedSelection() {
  const [selectedNodeId, setSelectedNodeIdRaw, selectedEdgeId, setSelectedEdgeId]
    = useMutualExclusionPair<NodeId, EdgeId>()
  const [focusMode, setFocus] = useState(false)

  const setSelectedNodeId = useCallback((nodeId: NodeId | null) => {
    setSelectedNodeIdRaw(nodeId)
    if (nodeId === null)
      setFocus(false)
  }, [setSelectedNodeIdRaw])

  // Turning focus on without a node to frame would narrow the canvas to
  // nothing, so the state refuses it rather than trusting every caller
  // to check first.
  const setFocusMode = useCallback((next: boolean) => {
    setFocus(next && selectedNodeId !== null)
  }, [selectedNodeId])

  return { selectedNodeId, setSelectedNodeId, selectedEdgeId, setSelectedEdgeId, focusMode, setFocusMode }
}
