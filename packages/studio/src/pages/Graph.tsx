import { useEffect, useState } from 'react'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GraphTablePage } from './GraphTable'

interface GraphPageProps {
  workspaceId: string
}

type GraphView = 'visualization' | 'table'

export function GraphPage({ workspaceId }: GraphPageProps) {
  const [view, setView] = useState<GraphView>('visualization')

  // Cmd+1 / Cmd+2 swap visualization ↔ table while the Graph tab is the
  // active page (the tab key event is global so this is safe as long as
  // GraphPage is mounted, which only happens on the Graph tab).
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
    <Tabs
      value={view}
      onValueChange={v => setView(v as GraphView)}
      className="flex h-full flex-col overflow-hidden gap-0"
    >
      <div className="border-b border-border px-4">
        <TabsList variant="line" className="h-9">
          <TabsTrigger value="visualization">Visualization</TabsTrigger>
          <TabsTrigger value="table">Table</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="visualization" className="flex-1 overflow-hidden">
        <GraphCanvas workspaceId={workspaceId} />
      </TabsContent>
      <TabsContent value="table" className="flex-1 overflow-hidden">
        <GraphTablePage workspaceId={workspaceId} />
      </TabsContent>
    </Tabs>
  )
}
