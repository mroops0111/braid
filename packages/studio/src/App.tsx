import { Command, FolderPlus, Settings2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CommandPalette, type TabKey } from './components/CommandPalette'
import { CreateWorkspaceWizard } from './components/CreateWorkspaceWizard'
import { InFlightRunBanner } from './components/InFlightRunBanner'
import { RegisterWorkspaceDialog } from './components/RegisterWorkspaceDialog'
import { Sidebar } from './components/Sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { WorkspaceDetailsSheet } from './components/WorkspaceDetailsSheet'
import { useWorkspaces } from './lib/queries'
import { useWorkspaceEvents } from './lib/useWorkspaceEvents'
import { GraphPage } from './pages/Graph'
import { ProposalsPage } from './pages/Proposals'
import { RunsPage } from './pages/Runs'
import { type SkillsContinuation, SkillsPage } from './pages/Skills'

export function App() {
  const { data: workspaces } = useWorkspaces()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('skills')
  const [continuation, setContinuation] = useState<SkillsContinuation | null>(null)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

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
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        workspaces={items}
        activeWorkspaceId={activeId}
        onSelect={setActiveId}
        onOpenDetails={openDetails}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        <Header workspaceId={activeId} onOpenDetails={() => activeId && openDetails(activeId)} />
        <InFlightRunBanner workspaceId={activeId} />
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
                    <TabsTrigger value="runs">Runs</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="skills" className="overflow-hidden">
                  <SkillsPage
                    workspaceId={activeId}
                    continuation={continuation}
                    onContinuationConsumed={() => setContinuation(null)}
                  />
                </TabsContent>
                <TabsContent value="graph" className="overflow-hidden">
                  <GraphPage workspaceId={activeId} />
                </TabsContent>
                <TabsContent value="proposals" className="overflow-hidden">
                  <ProposalsPage workspaceId={activeId} />
                </TabsContent>
                <TabsContent value="runs" className="overflow-hidden">
                  <RunsPage
                    workspaceId={activeId}
                    onContinue={(c) => {
                      setContinuation(c)
                      setActiveTab('skills')
                    }}
                  />
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
  )
}

function Header({ workspaceId, onOpenDetails }: { workspaceId: string | null, onOpenDetails: () => void }) {
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
  const [registerOpen, setRegisterOpen] = useState(false)

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="max-w-2xl text-center">
        <h1 className="text-base font-semibold">Welcome to Braid</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Pick how you want to start. You can switch later from the sidebar.
        </p>
      </div>
      <div className="mt-6 grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
        <ActionCard
          icon={Sparkles}
          title="Create New Workspace"
          description="Scaffold a fresh PRODUCT.md, pick intent + code sources, and let Braid ingest them."
          onClick={() => setWizardOpen(true)}
        />
        <ActionCard
          icon={FolderPlus}
          title="Register Existing"
          description="You already have a PRODUCT.md on disk and just want Braid to track it."
          onClick={() => setRegisterOpen(true)}
        />
      </div>
      <CreateWorkspaceWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={onSelect} />
      <RegisterWorkspaceDialog open={registerOpen} onOpenChange={setRegisterOpen} onRegistered={onSelect} />
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
