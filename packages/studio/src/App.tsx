import type { EdgeId, NodeId, ProposalId } from '@braidhq/schema'
import type { Surface } from './components/CommandPalette'
import { Settings2, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BatchInFlightBanner } from './components/BatchInFlightBanner'
import { CommandPalette } from './components/CommandPalette'
import { CreateWorkspaceWizard } from './components/CreateWorkspaceWizard'
import { InFlightRunBanner } from './components/InFlightRunBanner'
import { PageActions, PageActionsHost, PageActionsProvider } from './components/PageActions'
import { ReactorBanner } from './components/ReactorBanner'
import { Sidebar } from './components/Sidebar'
import { TooltipProvider } from './components/ui/tooltip'
import { UserPicker } from './components/UserPicker'
import { WorkspaceDetailsSheet } from './components/WorkspaceDetailsSheet'
import { useBatchStatus, useReactorCycles, useWorkspaces } from './lib/queries'
import { useAuthGate } from './lib/useAuthGate'
import { GraphNavigationContext } from './lib/useGraphNavigation'
import { useResetOnRemoteChange } from './lib/useRemoteWorkspaces'
import { TabNavigationContext } from './lib/useTabNavigation'
import { readUrl, useUrlSync } from './lib/useUrlState'
import { useWorkspaceEvents } from './lib/useWorkspaceEvents'
import { ActionsPage } from './pages/Actions'
import { ActivityPage } from './pages/Activity'
import { BatchPage } from './pages/Batch'
import { ClarifyPage } from './pages/Clarify'
import { GraphSurface, GraphSurfaceActions, useGraphSurfaceState } from './pages/GraphSurface'
import { HistoryPage } from './pages/History'
import { LoginPage } from './pages/Login'
import { ProposalsPage } from './pages/Proposals'
import { SettingsPage } from './pages/Settings'

export function App() {
  const gate = useAuthGate()
  if (gate.status === 'loading')
    return <BootScreen />
  if (gate.status === 'login')
    return <LoginPage initialError={gate.error ?? null} />
  return <AppInner />
}

function BootScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-background text-xs text-muted-foreground">
      Loading…
    </div>
  )
}

function AppInner() {
  useResetOnRemoteChange()
  const { data: workspaces } = useWorkspaces()
  // Initial state is hydrated from the URL, so refresh and deep links land back on the same workspace and surface.
  const initial = readUrl()
  const [activeId, setActiveId] = useState<string | null>(initial.workspaceId)
  // Graph is the workspace's home view. Secondary surfaces (Actions, Clarify, Proposals) overlay it when active.
  // `null` = home.
  const [activeSurface, setActiveSurface] = useState<Surface | null>(initial.surface)
  useUrlSync({ workspaceId: activeId, surface: activeSurface })
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const graphSurfaceState = useGraphSurfaceState()
  const { setSelectedNodeId, setSelectedEdgeId } = graphSurfaceState
  // One-shot deep-link target for the Proposals surface.
  // ProposalsPage consumes and clears it once it selects the matching item.
  const [focusedProposalId, setFocusedProposalId] = useState<ProposalId | null>(null)

  useEffect(() => {
    if (!workspaces?.items.length)
      return
    // The URL might point at a workspace that no longer exists, deleted between sessions.
    // Fall back to the first registered one.
    const exists = activeId && workspaces.items.some(w => w.id === activeId)
    if (!exists)
      setActiveId(workspaces.items[0]!.id)
  }, [activeId, workspaces])

  useWorkspaceEvents(activeId)

  const { data: activeBatchPlan } = useBatchStatus(activeId ?? undefined)
  const hasActiveBatch = activeBatchPlan?.status === 'running' || activeBatchPlan?.status === 'deriving'

  // Same query as ReactorBanner, React Query dedupes by key. Drives `InFlightRunBanner.suppress` below.
  // When the reactor is mid-cycle, the extract run is its own per-unit dispatch, shown by the Reactor banner.
  // Showing both would stack two banners for one activity.
  const { data: reactorCycles } = useReactorCycles(activeId)
  const hasActiveReactor = !!(reactorCycles?.items ?? []).find(p => p.status === 'dispatched' || p.status === 'running')

  const items = workspaces?.items ?? []

  function openDetails(id: string) {
    setDetailsId(id)
    setDetailsOpen(true)
  }

  // Deep-link from a Proposal or Clarify validation issue. Drop the overlaying surface so the user lands on the graph,
  // with their chosen node selected. The surface is one click away in the dock if they want to come back.
  const focusNode = useCallback((id: NodeId) => {
    setSelectedNodeId(id)
    setSelectedEdgeId(null)
    setActiveSurface(null)
  }, [setSelectedNodeId, setSelectedEdgeId])

  const focusEdge = useCallback((_id: EdgeId) => {
    setActiveSurface(null)
  }, [])

  const graphNavigation = useMemo(() => ({ focusNode, focusEdge }), [focusNode, focusEdge])

  const focusProposal = useCallback((id: ProposalId) => {
    setFocusedProposalId(id)
    setActiveSurface('proposals')
  }, [])

  const tabNavigation = useMemo(() => ({ focusProposal }), [focusProposal])

  return (
    <GraphNavigationContext.Provider value={graphNavigation}>
      <TabNavigationContext.Provider value={tabNavigation}>
        <PageActionsProvider>
          <TooltipProvider>
            <div className="flex h-screen overflow-hidden bg-background text-foreground">
              <Sidebar
                workspaces={items}
                activeWorkspaceId={activeId}
                activeSurface={activeSurface}
                onSelect={(id) => {
                  setActiveId(id)
                  if (activeSurface === 'settings')
                    setActiveSurface(null)
                }}
                onOpenDetails={openDetails}
                onGoHome={() => setActiveSurface(null)}
                onSelectSurface={setActiveSurface}
              />
              <main className="flex flex-1 flex-col overflow-hidden">
                {activeSurface === 'settings'
                  ? <SettingsPage />
                  : (
                      <>
                        <WorkspaceHeader
                          workspaceId={activeId}
                          activeSurface={activeSurface}
                          onOpenDetails={() => activeId && openDetails(activeId)}
                        />
                        <ReactorBanner workspaceId={activeId} onOpenActivity={() => setActiveSurface('activity')} />
                        <BatchInFlightBanner
                          workspaceId={activeId}
                          onOpenBatch={() => setActiveSurface('batch')}
                          suppress={activeSurface === 'batch'}
                        />
                        <InFlightRunBanner
                          workspaceId={activeId}
                          // Suppress on surfaces that render the run themselves,
                          // or when a batch banner already shows it.
                          // Both would point at the same in-flight extract subprocess.
                          suppress={activeSurface === 'actions' || activeSurface === 'batch' || hasActiveBatch || hasActiveReactor}
                        />
                        {activeId
                          ? (
                              <div className="relative flex-1 overflow-hidden">
                                {activeSurface === null && (
                                  <GraphHomeView
                                    workspaceId={activeId}
                                    state={graphSurfaceState}
                                    onStartBootstrap={() => setActiveSurface('batch')}
                                  />
                                )}
                                {activeSurface === 'actions' && (
                                  <ActionsPage workspaceId={activeId} />
                                )}
                                {activeSurface === 'clarify' && (
                                  <ClarifyPage workspaceId={activeId} />
                                )}
                                {activeSurface === 'proposals' && (
                                  <ProposalsPage
                                    workspaceId={activeId}
                                    focusedProposalId={focusedProposalId}
                                    onFocusConsumed={() => setFocusedProposalId(null)}
                                  />
                                )}
                                {activeSurface === 'activity' && (
                                  <ActivityPage workspaceId={activeId} />
                                )}
                                {activeSurface === 'history' && (
                                  <HistoryPage workspaceId={activeId} />
                                )}
                                {activeSurface === 'batch' && (
                                  <BatchPage workspaceId={activeId} />
                                )}
                              </div>
                            )
                          : (
                              <NoWorkspaceState onSelect={setActiveId} />
                            )}
                      </>
                    )}
              </main>
              <CommandPalette
                workspaces={items}
                activeWorkspaceId={activeId}
                activeSurface={activeSurface}
                onSelectWorkspace={setActiveId}
                onSelectSurface={setActiveSurface}
                onOpenWorkspaceDetails={() => activeId && openDetails(activeId)}
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
          </TooltipProvider>
        </PageActionsProvider>
      </TabNavigationContext.Provider>
    </GraphNavigationContext.Provider>
  )
}

/**
 * Inlined Graph home view.
 * Mounts the GraphSurface and routes its toolbar through the shared PageActions portal,
 * so view / focus controls sit in the contextual sub-bar alongside any future graph-only actions.
 */
function GraphHomeView({ workspaceId, state, onStartBootstrap }: {
  workspaceId: string
  state: ReturnType<typeof useGraphSurfaceState>
  onStartBootstrap: () => void
}) {
  const { view, setView, selectedNodeId, setSelectedNodeId, selectedEdgeId, setSelectedEdgeId, focusMode, setFocusMode } = state

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
        onStartBootstrap={onStartBootstrap}
      />
    </div>
  )
}

function WorkspaceHeader({ workspaceId, activeSurface, onOpenDetails }: {
  workspaceId: string | null
  activeSurface: Surface | null
  onOpenDetails: () => void
}) {
  // Surface nav lives in the Sidebar's HERE section now. The header reports where you are,
  // workspace name plus optional surface, and hosts page-specific tools on the right.
  const surfaceLabel
    = activeSurface === 'actions'
      ? 'Actions'
      : activeSurface === 'clarify'
        ? 'Clarify'
        : activeSurface === 'proposals'
          ? 'Proposals'
          : activeSurface === 'history'
            ? 'History'
            : null

  return (
    <header className="flex h-11 items-center justify-between gap-3 border-b border-border px-4">
      <div className="flex items-center gap-1.5 text-sm">
        {workspaceId
          ? (
              <>
                <button
                  type="button"
                  onClick={onOpenDetails}
                  title="Workspace settings (G W)"
                  className="group flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 font-mono text-foreground transition-colors hover:border-border hover:bg-accent"
                >
                  <span>{workspaceId}</span>
                  <Settings2 className="size-3 text-muted-foreground transition-colors group-hover:text-foreground" />
                </button>
                {surfaceLabel && (
                  <>
                    <span className="text-muted-foreground/40">/</span>
                    <span className="text-foreground/80">{surfaceLabel}</span>
                  </>
                )}
              </>
            )
          : (
              <>
                <span className="text-muted-foreground">Workspace</span>
                <span className="text-muted-foreground/60">(None Registered)</span>
              </>
            )}
      </div>
      <div className="flex items-center gap-2">
        {workspaceId && (
          <PageActionsHost className="flex items-center gap-2 empty:hidden" />
        )}
        <UserPicker />
      </div>
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
