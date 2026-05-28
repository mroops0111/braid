import type { useGraphSurfaceState } from './GraphSurface'
import { useEffect } from 'react'
import { PageActions } from '@/components/PageActions'
import { GraphSurface, GraphSurfaceActions } from './GraphSurface'

interface GraphPageProps {
  workspaceId: string
  // State is hoisted to App so cross-tab nav (e.g. clicking a node id
  // in a proposal validation issue) can drive selection.
  state: ReturnType<typeof useGraphSurfaceState>
}

export function GraphPage({ workspaceId, state }: GraphPageProps) {
  const { view, setView, selectedNodeId, setSelectedNodeId, selectedEdgeId, setSelectedEdgeId, focusMode, setFocusMode } = state

  // Cmd+1 / Cmd+2 swap visualization ↔ table while Graph is mounted.
  useEffect(() => {
    function handler(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey))
        return
      if (event.key === '1') {
        event.preventDefault()
        setView('visualization')
      }
      else if (event.key === '2') {
        event.preventDefault()
        setView('table')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setView])

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <PageActions>
        <GraphSurfaceActions
          view={view}
          onViewChange={setView}
          selectedNodeId={selectedNodeId}
          focusMode={focusMode}
          onFocusChange={setFocusMode}
        />
      </PageActions>
      <GraphSurface
        workspaceId={workspaceId}
        view={view}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        selectedEdgeId={selectedEdgeId}
        onSelectEdge={setSelectedEdgeId}
        focusMode={focusMode}
      />
    </div>
  )
}
