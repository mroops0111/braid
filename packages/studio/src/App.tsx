import { Command, Settings2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CommandPalette, type TabKey } from './components/CommandPalette'
import { CreateWorkspaceWizard } from './components/CreateWorkspaceWizard'
import { InFlightRunBanner } from './components/InFlightRunBanner'
import { PageActionsHost, PageActionsProvider } from './components/PageActions'
import { ServerUrlDialog } from './components/ServerUrlDialog'
import { Sidebar } from './components/Sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { WorkspaceDetailsSheet } from './components/WorkspaceDetailsSheet'
import { useWorkspaces } from './lib/queries'
import { useWorkspaceEvents } from './lib/useWorkspaceEvents'
import { ActionsPage } from './pages/Actions'
import { GraphPage } from './pages/Graph'
import { ProposalsPage } from './pages/Proposals'

export function App() {
  const { data: workspaces } = useWorkspaces()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('actions')
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [serverUrlOpen, setServerUrlOpen] = useState(false)

  useEffect(() => {
    if (!activeId && workspaces?.items.length) {
      setActiveId(workspaces.items[0]!.id)
    }
  }, [activeId, workspaces])

  useWorkspaceEvents(activeId)

  const items = workspaces?.items ?? []

  function openDetails(id: string) {
    setDetailsId(id)
    setDetailsOpen(true)
  }

  return (
    <PageActionsProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar
          workspaces={items}
          activeWorkspaceId={activeId}
          onSelect={setActiveId}
          onOpenDetails={openDetails}
          onOpenServerUrl={() => setServerUrlOpen(true)}
        />
        <main className="flex flex-1 flex-col overflow-hidden">
          <Header
            workspaceId={activeId}
            onOpenDetails={() => activeId && openDetails(activeId)}
          />
          <InFlightRunBanner workspaceId={activeId} />
          {activeId
            ? (
                <Tabs
                  value={activeTab}
                  onValueChange={value => setActiveTab(value as TabKey)}
                  className="flex flex-1 flex-col overflow-hidden gap-0"
                >
                  <div className="flex items-center justify-between border-b border-border px-4">
                    <TabsList variant="line" className="h-10">
                      <TabsTrigger value="actions">Actions</TabsTrigger>
                      <TabsTrigger value="graph">Graph</TabsTrigger>
                      <TabsTrigger value="proposals">Proposals</TabsTrigger>
                    </TabsList>
                    <PageActionsHost className="flex items-center gap-2" />
                  </div>
                  <TabsContent value="actions" className="overflow-hidden">
                    <ActionsPage workspaceId={activeId} />
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
                <NoWorkspaceState onSelect={setActiveId} />
              )}
        </main>
        <CommandPalette
          workspaces={items}
          activeWorkspaceId={activeId}
          activeTab={activeTab}
          onSelectWorkspace={setActiveId}
          onSelectTab={setActiveTab}
        />
        <ServerUrlDialog open={serverUrlOpen} onOpenChange={setServerUrlOpen} />
        <WorkspaceDetailsSheet
          workspaceId={detailsId}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          onUnregistered={() => {
            setDetailsOpen(false)
            if (activeId === detailsId)
              setActiveId(null)
            setDetailsId(null)
          }}
          onRenamed={(newId) => {
            if (activeId === detailsId)
              setActiveId(newId)
            setDetailsId(newId)
          }}
        />
      </div>
    </PageActionsProvider>
  )
}

function Header({ workspaceId, onOpenDetails }: {
  workspaceId: string | null
  onOpenDetails: () => void
}) {
  return (
    <header className="flex h-11 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Workspace</span>
        {workspaceId
          ? (
              <button
                type="button"
                onClick={onOpenDetails}
                title="Open workspace settings"
                className="group flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-foreground transition-colors hover:border-border hover:bg-accent"
              >
                <span className="font-mono">{workspaceId}</span>
                <Settings2 className="size-3 text-muted-foreground transition-colors group-hover:text-foreground" />
              </button>
            )
          : (
              <span className="text-muted-foreground/60">(none registered)</span>
            )}
      </div>
      <kbd className="hidden items-center gap-1 rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
        <Command className="size-3" />
        K
      </kbd>
    </header>
  )
}

function NoWorkspaceState({ onSelect }: { onSelect: (id: string) => void }) {
  const [wizardOpen, setWizardOpen] = useState(false)

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="max-w-2xl text-center">
        <h1 className="text-base font-semibold">Welcome to Braid</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Open a workspace to begin. Workspaces live under
          {' '}
          <code className="rounded bg-muted px-1">~/.braid/workspaces/</code>
          .
        </p>
      </div>
      <div className="mt-6 grid w-full max-w-md grid-cols-1 gap-3">
        <ActionCard
          icon={Sparkles}
          title="Open Workspace"
          description="Type a name to create a new one or open an existing workspace under the canonical root."
          onClick={() => setWizardOpen(true)}
        />
      </div>
      <CreateWorkspaceWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={onSelect} />
    </div>
  )
}

function ActionCard({ icon: Icon, title, description, onClick }: {
  icon: typeof Sparkles
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <div className="flex size-9 items-center justify-center rounded-lg bg-muted/60 transition-colors group-hover:bg-primary/10">
        <Icon className="size-4 text-foreground group-hover:text-primary" strokeWidth={1.5} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  )
}
