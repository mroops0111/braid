import type { EdgeId, NodeId, ProposalId } from '@braidhq/schema'
import type { Surface } from './components/CommandPalette'
import { NODE_REFERENCE_KIND } from '@braidhq/schema'
import { Settings2, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BatchInFlightBanner } from './components/BatchInFlightBanner'
import { CommandPalette } from './components/CommandPalette'
import { CreateWorkspaceWizard } from './components/CreateWorkspaceWizard'
import { InFlightRunBanner } from './components/InFlightRunBanner'
import { PageActions, PageActionsHost, PageActionsProvider } from './components/PageActions'
import { ReactorBanner } from './components/ReactorBanner'
import { ReferencePeekAside, ReferencePeekOverride, ReferencePeekProvider } from './components/references/ReferencePeek'
import { ReferenceRegistryProvider } from './components/references/ReferenceRegistryProvider'
import { Sidebar } from './components/Sidebar'
import { SourceAuthBanner } from './components/SourceAuthBanner'
import { SourceSyncBanner } from './components/SourceSyncBanner'
import { TooltipProvider } from './components/ui/tooltip'
import { UserPicker } from './components/UserPicker'
import { WorkspaceDetailsSheet } from './components/WorkspaceDetailsSheet'
import { asNodeId } from './lib/brands'
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
import { ClarificationPage } from './pages/Clarification'
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
  const { t } = useTranslation()
  return (
    <div className="flex h-screen items-center justify-center bg-background text-xs text-muted-foreground">
      {t('common.loading')}
    </div>
  )
}

function AppInner() {
  useResetOnRemoteChange()
  const { data: workspaces } = useWorkspaces()
  // Initial state is hydrated from the URL, so refresh and deep links land back on the same workspace and surface.
  const initial = readUrl()
  const [activeId, setActiveId] = useState<string | null>(initial.workspaceId)
  // Graph is the workspace's home view. Secondary surfaces (Actions, Clarification, Proposals) overlay it when active.
  // `null` = home.
  const [activeSurface, setActiveSurface] = useState<Surface | null>(initial.surface)
  useUrlSync({ workspaceId: activeId, surface: activeSurface })
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const graphSurfaceState = useGraphSurfaceState()
  // Lifted out of the palette so a visible control can open it,
  // rather than the shortcut being the only way in.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { setSelectedNodeId, setSelectedEdgeId, setFocusMode, requestCenter } = graphSurfaceState
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

  // Selecting alone dims every non-neighbour and leaves the target off screen,
  // so an arrival needs centring and focus to land on something readable.
  const focusNode = useCallback((id: NodeId) => {
    setSelectedNodeId(id)
    setSelectedEdgeId(null)
    setFocusMode(true)
    requestCenter()
    setActiveSurface(null)
  }, [setSelectedNodeId, setSelectedEdgeId, setFocusMode, requestCenter])

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
        <ReferenceRegistryProvider workspaceId={activeId ?? undefined}>
          <ReferencePeekProvider resetKey={activeSurface ?? 'graph'}>
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
                            <SourceAuthBanner workspaceId={activeId} onOpenDetails={() => activeId && openDetails(activeId)} />
                            <SourceSyncBanner workspaceId={activeId} onOpenDetails={() => activeId && openDetails(activeId)} />
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
                                  <div key={activeSurface ?? 'graph'} className="relative flex-1 overflow-hidden duration-150 animate-in fade-in-0">
                                    {activeSurface === null && (
                                      <GraphHomeView
                                        workspaceId={activeId}
                                        state={graphSurfaceState}
                                        onStartBootstrap={() => setActiveSurface('batch')}
                                        onOpenSearch={() => setPaletteOpen(true)}
                                      />
                                    )}
                                    {activeSurface === 'actions' && (
                                      <ActionsPage workspaceId={activeId} />
                                    )}
                                    {activeSurface === 'clarifications' && (
                                      <ClarificationPage workspaceId={activeId} />
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
                  <ReferencePeekAside />
                  <CommandPalette
                    workspaces={items}
                    activeWorkspaceId={activeId}
                    activeSurface={activeSurface}
                    onSelectWorkspace={setActiveId}
                    onSelectSurface={setActiveSurface}
                    onOpenWorkspaceDetails={() => activeId && openDetails(activeId)}
                    onSelectNode={focusNode}
                    open={paletteOpen}
                    onOpenChange={setPaletteOpen}
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
          </ReferencePeekProvider>
        </ReferenceRegistryProvider>
      </TabNavigationContext.Provider>
    </GraphNavigationContext.Provider>
  )
}

/**
 * Inlined Graph home view.
 * Mounts the GraphSurface and routes its toolbar through the shared PageActions portal,
 * so view / focus controls sit in the contextual sub-bar alongside any future graph-only actions.
 */
function GraphHomeView({ workspaceId, state, onStartBootstrap, onOpenSearch }: {
  workspaceId: string
  state: ReturnType<typeof useGraphSurfaceState>
  onStartBootstrap: () => void
  onOpenSearch: () => void
}) {
  const { view, setView, selectedNodeId, setSelectedNodeId, selectedEdgeId, setSelectedEdgeId, focusMode, setFocusMode, centerRequest, requestCenter } = state

  // This surface already shows node detail,
  // so a reference swaps that panel rather than opening an identical one.
  const revealNode = useCallback((id: string) => {
    setSelectedEdgeId(null)
    setSelectedNodeId(asNodeId(id))
    requestCenter()
  }, [setSelectedNodeId, setSelectedEdgeId, requestCenter])

  return (
    <ReferencePeekOverride kind={NODE_REFERENCE_KIND} onOpen={revealNode}>
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
          centerRequest={centerRequest}
          onOpenSearch={onOpenSearch}
          onStartBootstrap={onStartBootstrap}
        />
      </div>
    </ReferencePeekOverride>
  )
}

function WorkspaceHeader({ workspaceId, activeSurface, onOpenDetails }: {
  workspaceId: string | null
  activeSurface: Surface | null
  onOpenDetails: () => void
}) {
  const { t } = useTranslation()
  // Surface nav lives in the Sidebar's HERE section now. The header reports where you are,
  // workspace name plus optional surface, and hosts page-specific tools on the right.
  const surfaceLabel
    = activeSurface === 'actions'
      ? t('shell.surfaces.actions')
      : activeSurface === 'clarifications'
        ? t('shell.surfaces.clarifications')
        : activeSurface === 'proposals'
          ? t('shell.surfaces.proposals')
          : activeSurface === 'history'
            ? t('shell.surfaces.history')
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
                  title={t('shell.header.workspaceSettingsTooltip')}
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
                <span className="text-muted-foreground">{t('shell.header.workspaceLabel')}</span>
                <span className="text-muted-foreground/60">{t('shell.header.noneRegistered')}</span>
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
  const { t } = useTranslation()
  const [wizardOpen, setWizardOpen] = useState(false)

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="max-w-2xl text-center">
        <h1 className="text-base font-semibold">{t('shell.noWorkspace.title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t('shell.noWorkspace.description')}
        </p>
      </div>
      <div className="mt-6 grid w-full max-w-md grid-cols-1 gap-3">
        <ActionCard
          icon={Sparkles}
          title={t('shell.noWorkspace.openWorkspaceTitle')}
          description={t('shell.noWorkspace.openWorkspaceDescription')}
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
