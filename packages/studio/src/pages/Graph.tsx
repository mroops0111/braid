import { useEffect } from 'react'
import { PageActions } from '@/components/PageActions'
import { GraphSurface, GraphSurfaceActions, useGraphSurfaceState } from './GraphSurface'

interface GraphPageProps {
  workspaceId: string
}

export function GraphPage({ workspaceId }: GraphPageProps) {
  const { view, setView, selectedNodeId, setSelectedNodeId, focusMode, setFocusMode } = useGraphSurfaceState()

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
        focusMode={focusMode}
      />
    </div>
  )
}
