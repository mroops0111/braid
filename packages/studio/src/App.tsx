import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { useWorkspaces } from './lib/queries'
import { GraphPage } from './pages/Graph'
import { ProposalsPage } from './pages/Proposals'
import { SkillsPage } from './pages/Skills'

export function App() {
  const { data: workspaces } = useWorkspaces()
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (!activeId && workspaces?.items.length) {
      setActiveId(workspaces.items[0]!.id)
    }
  }, [activeId, workspaces])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        workspaces={workspaces?.items ?? []}
        activeWorkspaceId={activeId}
        onSelect={setActiveId}
      />
      <main className="flex flex-1 flex-col overflow-hidden bg-zinc-950">
        <Header workspaceId={activeId} />
        {activeId
          ? (
              <Tabs defaultValue="skills" className="flex flex-1 flex-col overflow-hidden">
                <TabsList>
                  <TabsTrigger value="skills">Skills</TabsTrigger>
                  <TabsTrigger value="graph">Graph</TabsTrigger>
                  <TabsTrigger value="proposals">Proposals</TabsTrigger>
                </TabsList>
                <TabsContent value="skills" className="overflow-hidden">
                  <SkillsPage workspaceId={activeId} />
                </TabsContent>
                <TabsContent value="graph" className="overflow-hidden">
                  <GraphPage workspaceId={activeId} />
                </TabsContent>
                <TabsContent value="proposals" className="overflow-hidden">
                  <ProposalsPage workspaceId={activeId} />
                </TabsContent>
              </Tabs>
            )
          : (
              <EmptyState />
            )}
      </main>
    </div>
  )
}

function Header({ workspaceId }: { workspaceId: string | null }) {
  return (
    <header className="flex h-11 items-center border-b border-zinc-800 px-4">
      <div className="text-sm text-zinc-500">
        Workspace
        {workspaceId
          ? (
              <span className="ml-1.5 font-mono text-zinc-200">{workspaceId}</span>
            )
          : (
              <span className="ml-1.5 text-zinc-600">— none registered</span>
            )}
      </div>
    </header>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
      Register a workspace from the sidebar to get started.
    </div>
  )
}
