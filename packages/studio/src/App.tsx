import { Command } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CommandPalette, type TabKey } from './components/CommandPalette'
import { Sidebar } from './components/Sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { useWorkspaces } from './lib/queries'
import { GraphPage } from './pages/Graph'
import { ProposalsPage } from './pages/Proposals'
import { SkillsPage } from './pages/Skills'

export function App() {
  const { data: workspaces } = useWorkspaces()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('skills')

  useEffect(() => {
    if (!activeId && workspaces?.items.length) {
      setActiveId(workspaces.items[0]!.id)
    }
  }, [activeId, workspaces])

  const items = workspaces?.items ?? []

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        workspaces={items}
        activeWorkspaceId={activeId}
        onSelect={setActiveId}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        <Header workspaceId={activeId} />
        {activeId
          ? (
              <Tabs
                value={activeTab}
                onValueChange={value => setActiveTab(value as TabKey)}
                className="flex flex-1 flex-col overflow-hidden gap-0"
              >
                <div className="border-b border-border px-4">
                  <TabsList variant="line" className="h-10">
                    <TabsTrigger value="skills">Skills</TabsTrigger>
                    <TabsTrigger value="graph">Graph</TabsTrigger>
                    <TabsTrigger value="proposals">Proposals</TabsTrigger>
                  </TabsList>
                </div>
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
      <CommandPalette
        workspaces={items}
        activeWorkspaceId={activeId}
        activeTab={activeTab}
        onSelectWorkspace={setActiveId}
        onSelectTab={setActiveTab}
      />
    </div>
  )
}

function Header({ workspaceId }: { workspaceId: string | null }) {
  return (
    <header className="flex h-11 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Workspace</span>
        {workspaceId
          ? (
              <span className="font-mono text-foreground">{workspaceId}</span>
            )
          : (
              <span className="text-muted-foreground/60">— none registered</span>
            )}
      </div>
      <kbd className="hidden items-center gap-1 rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
        <Command className="size-3" />
        K
      </kbd>
    </header>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Register a workspace from the sidebar to get started.
    </div>
  )
}
