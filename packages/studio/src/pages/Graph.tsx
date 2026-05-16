import { LayoutGrid, Network } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { cn } from '@/lib/utils'
import { GraphTablePage } from './GraphTable'

interface GraphPageProps {
  workspaceId: string
}

export type GraphView = 'visualization' | 'table'

export function GraphPage({ workspaceId }: GraphPageProps) {
  const [view, setView] = useState<GraphView>('visualization')

  // Cmd+1 / Cmd+2 swap visualization ↔ table while Graph is the active
  // page. Keep the listener scoped to mount so other tabs' shortcuts
  // are unaffected.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
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
  }, [])

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {view === 'visualization'
        ? <GraphCanvas workspaceId={workspaceId} viewToggle={<ViewToggle view={view} onChange={setView} />} />
        : (
            <>
              <div className="pointer-events-none absolute right-3 top-3 z-10">
                <div className="pointer-events-auto">
                  <ViewToggle view={view} onChange={setView} />
                </div>
              </div>
              <GraphTablePage workspaceId={workspaceId} />
            </>
          )}
    </div>
  )
}

function ViewToggle({ view, onChange }: { view: GraphView, onChange: (view: GraphView) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Graph view"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-sm"
    >
      <ToggleButton
        active={view === 'visualization'}
        onClick={() => onChange('visualization')}
        ariaLabel="Visualization view (Cmd+1)"
      >
        <Network className="size-3.5" />
      </ToggleButton>
      <ToggleButton
        active={view === 'table'}
        onClick={() => onChange('table')}
        ariaLabel="Table view (Cmd+2)"
      >
        <LayoutGrid className="size-3.5" />
      </ToggleButton>
    </div>
  )
}

function ToggleButton({ active, onClick, ariaLabel, children }: {
  active: boolean
  onClick: () => void
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-sm transition-colors duration-150',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
