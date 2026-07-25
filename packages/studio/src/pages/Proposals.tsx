import type { EdgeId, GraphEdgeCreate, GraphNodeCreate, GraphOperation, NodeId, Proposal, ProposalId, ProposalStatus, ValidationIssue, ValidationSeverity } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, Check, ChevronDown, ChevronRight, Inbox, Info, MinusCircle, PencilLine, PlusCircle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { useProposalGraphDataSource } from '@/components/graph/GraphDataSource'
import { FocusToggle, OnlyChangesToggle } from '@/components/graph/GraphToolbar'
import { ListRow } from '@/components/ListRow'
import { PageActions } from '@/components/PageActions'
import { StatusBadge } from '@/components/StatusBadge'
import { SurfaceLayout } from '@/components/SurfaceLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FILTER_TAB_TRIGGER, FILTER_TABS_LIST } from '@/components/ui/filterTabs'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { queryKeys, useProposalsByStatus, useProposalValidation, useWorkspaceMembers } from '@/lib/queries'
import { useGraphNavigation } from '@/lib/useGraphNavigation'
import { useMutualExclusionPair } from '@/lib/useMutualExclusionPair'
import { useWorkspacePolicy } from '@/policy'
import { GraphSurface } from './GraphSurface'

interface ProposalsPageProps {
  workspaceId: string
  /**
   * One-shot deep-link target.
   * When set, such as clicking "Proposal #abc" on an applied Clarification,
   * the page scans its current list for the matching proposal.
   * If found in the current status filter, it is selected,
   * otherwise the page sweeps the other statuses,
   * and switches the filter to wherever the proposal actually lives.
   */
  focusedProposalId?: ProposalId | null
  onFocusConsumed?: () => void
}

type StatusFilter = Extract<ProposalStatus, 'pending' | 'applied' | 'rejected'>

const EMPTY_COPY: Record<StatusFilter, { title: string, description: string }> = {
  pending: {
    title: 'No Pending Proposals',
    description: 'Run /ddd:extract or /ddd:clarify to produce graph mutations awaiting HITL review.',
  },
  applied: {
    title: 'No Applied Proposals',
    description: 'Proposals you accept will land here as a permanent record.',
  },
  rejected: {
    title: 'No Rejected Proposals',
    description: 'Proposals you reject will land here so you can re-read the reason later.',
  },
}

export function ProposalsPage({ workspaceId, focusedProposalId, onFocusConsumed }: ProposalsPageProps) {
  // Status filter is both the list query and the detail pane's read-only cue.
  // Switching status clears the selected proposal,
  // so the right pane cannot show an item that no longer matches.
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [showAll, setShowAll] = useState(false)
  const { data, isLoading } = useProposalsByStatus(workspaceId, status, showAll)
  const [selected, setSelected] = useState<Proposal | null>(null)
  // Tracks an in-progress sweep across statuses for a deep-link focus.
  // Each entry remembers which status filters we've already checked,
  // so we don't loop on an id that doesn't exist in any list.
  const [focusSweep, setFocusSweep] = useState<{ proposalId: ProposalId, attempted: Set<StatusFilter> } | null>(null)

  function changeStatus(next: StatusFilter): void {
    setStatus(next)
    setSelected(null)
  }

  // Seed the sweep when a new focusedProposalId arrives.
  // Status is intentionally excluded from deps,
  // this effect must fire only on the externally driven id change,
  // not when the user is mid-sweep switching filters.
  useEffect(() => {
    if (focusedProposalId)
      setFocusSweep(prev => prev?.proposalId === focusedProposalId ? prev : { proposalId: focusedProposalId, attempted: new Set([status]) })
  }, [focusedProposalId, status])

  // Drive the sweep. Try the current list,
  // if no match advance to the next unchecked status.
  // Consumes the focus once we select the proposal or exhaust the statuses.
  useEffect(() => {
    if (!focusSweep || isLoading || !data)
      return
    const match = data.items.find(p => p.id === focusSweep.proposalId)
    if (match) {
      setSelected(match)
      setFocusSweep(null)
      onFocusConsumed?.()
      return
    }
    const candidates: StatusFilter[] = ['pending', 'applied', 'rejected']
    const next = candidates.find(s => !focusSweep.attempted.has(s))
    if (!next) {
      setFocusSweep(null)
      onFocusConsumed?.()
      return
    }
    setStatus(next)
    setFocusSweep({ proposalId: focusSweep.proposalId, attempted: new Set([...focusSweep.attempted, next]) })
  }, [focusSweep, data, isLoading, onFocusConsumed])

  // Auto-select the first item when entering a list with no selection.
  // Covers initial mount, status switch, and complete-and-clear from detail.
  // Skip while a deep-link focus sweep is in flight,
  // so we do not race the sweep's setSelected call.
  useEffect(() => {
    if (focusSweep || selected || isLoading || !data?.items.length)
      return
    setSelected(data.items[0]!)
  }, [data, selected, isLoading, focusSweep])

  return (
    <div className="flex h-full flex-col">
      <PageActions>
        <ProposalsStatusFilter workspaceId={workspaceId} status={status} onChange={changeStatus} />
        <ShowAllToggle workspaceId={workspaceId} status={status} showAll={showAll} onToggle={setShowAll} />
      </PageActions>
      <SurfaceLayout
        list={(
          <>
            {isLoading
              ? (
                  <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                )
              : !data || data.items.length === 0
                  ? null
                  : (
                      <ul className="flex-1 overflow-y-auto scrollbar-thin">
                        {data.items.map(proposal => (
                          <ListRow
                            key={proposal.id}
                            active={selected?.id === proposal.id}
                            onClick={() => setSelected(proposal)}
                            className="flex-col gap-1"
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <span className="break-all font-mono text-xs text-foreground">{proposal.id}</span>
                              <StatusBadge status={proposal.status} />
                            </div>
                            <div className="text-2xs text-muted-foreground">
                              {proposal.operations.length}
                              {' '}
                              ops · by
                              {' '}
                              {proposal.generatedBy}
                            </div>
                          </ListRow>
                        ))}
                      </ul>
                    )}
          </>
        )}
      >
        <div className="flex-1 overflow-hidden">
          {selected
            ? (
                <ProposalDetail
                  workspaceId={workspaceId}
                  proposal={selected}
                  onComplete={() => setSelected(null)}
                  key={selected.id}
                />
              )
            : (
                <EmptyState
                  icon={Inbox}
                  title={data?.items.length ? 'Pick a Proposal' : EMPTY_COPY[status].title}
                  description={
                    data?.items.length
                      ? status === 'pending'
                        ? 'Select a proposal on the left to review the operations and apply or reject it.'
                        : 'Select a proposal on the left to review the operations and rationale.'
                      : EMPTY_COPY[status].description
                  }
                />
              )}
        </div>
      </SurfaceLayout>
    </div>
  )
}

/**
 * Owner-only toggle that flips the personal-pending filter to "everyone's".
 * Only rendered on the pending tab,
 * applied and rejected lists are shared by definition,
 * so a toggle there would do nothing.
 * Cmd-click suppression keeps it small and tucked next to the status tabs.
 */
function ShowAllToggle({
  workspaceId,
  status,
  showAll,
  onToggle,
}: {
  workspaceId: string
  status: StatusFilter
  showAll: boolean
  onToggle: (next: boolean) => void
}) {
  const { effectiveRole } = useWorkspacePolicy(workspaceId)
  const { data: members } = useWorkspaceMembers(workspaceId)
  // Nothing to disambiguate on a solo workspace, every proposal is yours.
  const multiMember = (members?.items.length ?? 0) > 1
  if (effectiveRole !== 'owner' || status !== 'pending' || !multiMember)
    return null
  return (
    <Button
      variant={showAll ? 'default' : 'ghost'}
      size="sm"
      className="h-7 text-2xs"
      onClick={() => onToggle(!showAll)}
      title={showAll ? 'Showing pending proposals from every member' : 'Showing only your own pending proposals'}
    >
      {showAll ? 'Showing All' : 'Mine Only'}
    </Button>
  )
}

// Pending, Applied, Rejected segment.
// Rendered via PageActions into the top tab row,
// so it takes no row of its own.
// Pending wears a live count badge, the only one worth surfacing.
// Applied and rejected lists grow monotonically, a count there is noise.
function ProposalsStatusFilter({
  workspaceId,
  status,
  onChange,
}: {
  workspaceId: string
  status: StatusFilter
  onChange: (next: StatusFilter) => void
}) {
  const { data: pending } = useProposalsByStatus(workspaceId, 'pending')
  const pendingCount = pending?.items.length ?? 0
  return (
    <Tabs value={status} onValueChange={value => onChange(value as StatusFilter)}>
      <TabsList className={FILTER_TABS_LIST}>
        <TabsTrigger value="pending" className={FILTER_TAB_TRIGGER}>
          Pending
          {pendingCount > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-px text-2xs font-medium leading-none text-primary">
              {pendingCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="applied" className={FILTER_TAB_TRIGGER}>Applied</TabsTrigger>
        <TabsTrigger value="rejected" className={FILTER_TAB_TRIGGER}>Rejected</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

function ProposalDetail({
  workspaceId,
  proposal,
  onComplete,
}: {
  workspaceId: string
  proposal: Proposal
  onComplete: () => void
}) {
  const queryClient = useQueryClient()
  const [rejectReason, setRejectReason] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)

  // Apply and Reject are only meaningful while the proposal is pending.
  // Applied and rejected entries are read-only history.
  const isPending = proposal.status === 'pending'
  const canWrite = useWorkspacePolicy(workspaceId).can('proposal.write')

  const validation = useProposalValidation(workspaceId, isPending ? proposal.id : null)
  const errorCount = validation.data?.issues.filter(issue => issue.severity === 'error').length ?? 0
  const blockedByErrors = errorCount > 0

  // Invalidate the whole proposals namespace for this workspace,
  // so the entry moves from Pending into Applied or Rejected,
  // without a manual refresh.
  function invalidateProposals(): void {
    queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'proposals'] })
  }

  const apply = useMutation({
    mutationFn: () => api.applyProposal(workspaceId, proposal.id),
    onSuccess: () => {
      invalidateProposals()
      queryClient.invalidateQueries({ queryKey: queryKeys.modelSnapshot(workspaceId) })
      onComplete()
    },
  })

  const reject = useMutation({
    mutationFn: (reason: string) => api.rejectProposal(workspaceId, proposal.id, reason),
    onSuccess: () => {
      invalidateProposals()
      onComplete()
    },
  })

  const applyTitle = blockedByErrors
    ? `Cannot apply: ${errorCount} validation error${errorCount === 1 ? '' : 's'} must be resolved first.`
    : undefined

  const title = firstSentence(proposal.rationale)
  const hasMoreRationale = title !== proposal.rationale.trim()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-2xs text-muted-foreground">{proposal.id}</div>
          <div className="truncate text-sm font-medium text-foreground" title={proposal.rationale}>
            {title}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isPending && canWrite && (
            <>
              <Button
                size="sm"
                disabled={apply.isPending || blockedByErrors || validation.isLoading}
                onClick={() => apply.mutate()}
                title={applyTitle}
              >
                <Check />
                Apply
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={reject.isPending}
                onClick={() => setRejectOpen(open => !open)}
              >
                <X />
                Reject
              </Button>
            </>
          )}
          {(!isPending || !canWrite) && <StatusBadge status={proposal.status} />}
        </div>
      </header>
      <div className="shrink-0">
        {isPending && (
          <ValidationPanel
            isLoading={validation.isLoading}
            error={validation.error}
            issues={validation.data?.issues ?? []}
            ok={validation.data?.ok ?? null}
          />
        )}

        {rejectOpen && isPending && (
          <RejectForm
            value={rejectReason}
            onChange={setRejectReason}
            onCancel={() => {
              setRejectOpen(false)
              setRejectReason('')
            }}
            onSubmit={() => reject.mutate(rejectReason.trim())}
            isPending={reject.isPending}
          />
        )}

        {hasMoreRationale && (
          <RationaleSection text={proposal.rationale} firstSentence={title} />
        )}

        {(apply.error || reject.error) && (
          <div className="mx-4 mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {((apply.error ?? reject.error) as Error).message}
          </div>
        )}
      </div>

      <ProposalPreview workspaceId={workspaceId} operations={proposal.operations} />
    </div>
  )
}

function firstSentence(text: string): string {
  // Cut at the first period followed by space or newline.
  // Keeps the header compact when an LLM writes a multi-sentence rationale.
  const match = text.trim().match(/^.+?[.。!?](?:\s|$)/s)
  return (match ? match[0] : text.trim()).trim()
}

function RationaleSection({ text, firstSentence: shown }: { text: string, firstSentence: string }) {
  const [open, setOpen] = useState(false)
  const rest = text.trim().slice(shown.length).trim()
  if (!rest)
    return null
  return (
    <div className="px-4 pt-3 pb-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        Rationale
      </button>
      {open && (
        <p className="mt-1.5 whitespace-pre-wrap rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground/90">
          {text.trim()}
        </p>
      )}
    </div>
  )
}

function ValidationPanel({ isLoading, error, issues, ok }: {
  isLoading: boolean
  error: unknown
  issues: readonly ValidationIssue[]
  ok: boolean | null
}) {
  if (isLoading) {
    return <p className="px-4 pt-3 text-2xs text-muted-foreground">Validating against the current graph…</p>
  }
  if (error) {
    return (
      <p className="mx-4 mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-2xs text-destructive">
        Validation request failed:
        {' '}
        {error instanceof Error ? error.message : String(error)}
      </p>
    )
  }
  if (ok && issues.length === 0) {
    return (
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="size-4 shrink-0" />
        <span>
          <strong className="font-semibold">No validation issues.</strong>
          {' '}
          Safe to apply.
        </span>
      </div>
    )
  }
  const grouped = groupBySeverity(issues)
  return (
    <div className="space-y-2 px-4 pt-3">
      {(['error', 'warning', 'info'] as const).map((severity) => {
        const list = grouped[severity]
        if (list.length === 0)
          return null
        return <IssueGroup key={severity} severity={severity} issues={list} />
      })}
    </div>
  )
}

const SEVERITY_PALETTE: Record<ValidationSeverity, {
  icon: typeof AlertCircle
  border: string
  bg: string
  text: string
}> = {
  error: { icon: AlertCircle, border: 'border-destructive/40', bg: 'bg-destructive/5', text: 'text-destructive' },
  warning: { icon: AlertTriangle, border: 'border-amber-500/40', bg: 'bg-amber-500/5', text: 'text-amber-500' },
  info: { icon: Info, border: 'border-border', bg: 'bg-muted/30', text: 'text-muted-foreground' },
}

function IssueGroup({ severity, issues }: { severity: ValidationSeverity, issues: readonly ValidationIssue[] }) {
  const palette = SEVERITY_PALETTE[severity]
  const Icon = palette.icon
  return (
    <div className={`rounded-md border ${palette.border} ${palette.bg} px-3 py-2`}>
      <div className={`flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider ${palette.text}`}>
        <Icon className="size-3" />
        {severity}
        {' '}
        (
        {issues.length}
        )
      </div>
      <ul className="mt-1.5 space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`} className="text-2xs text-foreground/90">
            <span className="font-mono text-foreground/60">
              [
              {issue.code}
              ]
            </span>
            {' '}
            {issue.message}
            <IssueTarget issue={issue} />
          </li>
        ))}
      </ul>
    </div>
  )
}

// Renders the trailing arrow pointer to nodeId on a validation issue.
// When a GraphNavigation context is in scope,
// nodeId and edgeId become buttons that switch to the Graph tab.
function IssueTarget({ issue }: { issue: ValidationIssue }) {
  const nav = useGraphNavigation()
  if (!issue.nodeId && !issue.edgeId && !issue.path)
    return null
  const linkClass = 'rounded font-mono text-2xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline'
  if (issue.nodeId && nav) {
    return (
      <span className="ml-1 inline-flex items-center gap-1 text-muted-foreground">
        →
        <button
          type="button"
          onClick={() => nav.focusNode(issue.nodeId as NodeId)}
          className={linkClass}
          title="Open in Graph"
        >
          {issue.nodeId}
        </button>
      </span>
    )
  }
  if (issue.edgeId && nav) {
    return (
      <span className="ml-1 inline-flex items-center gap-1 text-muted-foreground">
        →
        <button
          type="button"
          onClick={() => nav.focusEdge(issue.edgeId as EdgeId)}
          className={linkClass}
          title="Open in Graph"
        >
          {issue.edgeId}
        </button>
      </span>
    )
  }
  return (
    <span className="ml-1 font-mono text-2xs text-muted-foreground">
      →
      {' '}
      {issue.nodeId ?? issue.edgeId ?? issue.path}
    </span>
  )
}

function RejectForm({ value, onChange, onCancel, onSubmit, isPending }: {
  value: string
  onChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
  isPending: boolean
}) {
  const hasReason = value.trim().length > 0
  return (
    <div className="mx-4 mt-3 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
      <label className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        Reject Reason
      </label>
      <textarea
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder="Why are you rejecting this proposal? Pasted into the decision log; useful for skill iteration."
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!hasReason || isPending}
          onClick={onSubmit}
        >
          {isPending ? 'Rejecting…' : 'Submit Rejection'}
        </Button>
      </div>
    </div>
  )
}

type PreviewView = 'graph' | 'list'

/**
 * Dual-view preview for the proposal's effect on the graph.
 * - **List**: grouped add, update, and remove rows, the densest summary.
 * - **Graph**: reuses the workspace `GraphCanvas`,
 * fed with a derived data source that applies the proposal's operations,
 * and annotates nodes and edges with their change kind.
 *
 * The source is computed once via `useProposalGraphDataSource`,
 * and shared across views so toggling is cheap.
 */
/**
 * Threshold for auto-flipping `emphasizeAdded`.
 * A proposal touching less than this fraction of the live graph,
 * counts as "incremental".
 * The diff would otherwise be a handful of small green dots,
 * in a sea of unmarked context, which is easy to miss.
 */
const INCREMENTAL_RATIO_THRESHOLD = 0.3

function ProposalPreview({ workspaceId, operations }: { workspaceId: string, operations: readonly GraphOperation[] }) {
  // Proposal preview pairs the graph visualization with a flat list view.
  // We manage `view` here,
  // and delegate the graph view to GraphSurface.
  const [view, setView] = useState<PreviewView>('graph')
  const [selectedNodeId, setSelectedNodeId, selectedEdgeId, setSelectedEdgeId]
    = useMutualExclusionPair<NodeId, EdgeId>()
  const [focusMode, setFocusMode] = useState(false)
  const [onlyChanges, setOnlyChanges] = useState(false)
  const source = useProposalGraphDataSource(workspaceId, operations)
  const flat = flattenOperations(operations)

  const addCount = flat.filter(op => op.kind === 'add').length
  const updateCount = flat.filter(op => op.kind === 'update').length
  const removeCount = flat.filter(op => op.kind === 'remove').length

  // Incremental proposals dilute their own visual,
  // a few green dots in a sea of unmarked context.
  // When the diff touches under 30% of the preview snapshot,
  // beef up the `added` treatment with a green ring and shadow,
  // not a corner dot.
  // The fresh-extract case, close to 100% touched, keeps the subtle markers,
  // so the type colour is not drowned in green.
  const changedCount = (source.diff?.nodes.size ?? 0) + (source.diff?.edges.size ?? 0)
  const totalCount = source.nodes.length + source.edges.length
  const incrementalRatio = totalCount > 0 ? changedCount / totalCount : 1
  const emphasizeAdded = incrementalRatio < INCREMENTAL_RATIO_THRESHOLD

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            Preview (
            {flat.length}
            {' '}
            ops)
          </h3>
          <ProposalImpactSummary adds={addCount} updates={updateCount} removes={removeCount} />
        </div>
        <div className="flex items-center gap-2">
          {view !== 'list' && changedCount > 0 && (
            <OnlyChangesToggle active={onlyChanges} onChange={setOnlyChanges} />
          )}
          {selectedNodeId && view !== 'list' && (
            <FocusToggle active={focusMode} onChange={setFocusMode} />
          )}
          <div role="tablist" aria-label="Preview view" className="inline-flex items-center gap-0.5 rounded border border-border bg-card p-0.5">
            <ViewTab active={view === 'graph'} onClick={() => setView('graph')}>Graph</ViewTab>
            <ViewTab active={view === 'list'} onClick={() => setView('list')}>List</ViewTab>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'list'
          ? <OperationList flat={flat} />
          : (
              <GraphSurface
                workspaceId={workspaceId}
                source={source}
                view="visualization"
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                selectedEdgeId={selectedEdgeId}
                onSelectEdge={setSelectedEdgeId}
                focusMode={focusMode}
                dimUnchanged={onlyChanges}
                emphasizeAdded={emphasizeAdded}
              />
            )}
      </div>
    </section>
  )
}

/**
 * Compact `+N / ~M / -K` chip set rendered next to the preview title.
 * Makes the impact of small incremental proposals visible,
 * without forcing the reviewer to scan the canvas for thin stroke differences,
 * such as a model audit fix that adds 4 edges and changes nothing else.
 */
function ProposalImpactSummary({ adds, updates, removes }: { adds: number, updates: number, removes: number }) {
  const total = adds + updates + removes
  if (total === 0) {
    return <span className="text-2xs text-muted-foreground/70">empty</span>
  }
  return (
    <span className="flex items-baseline gap-1.5 text-2xs font-mono">
      {adds > 0 && (
        <span className="text-emerald-600 dark:text-emerald-400" title={`${adds} added`}>
          +
          {adds}
        </span>
      )}
      {updates > 0 && (
        <span className="text-amber-600 dark:text-amber-400" title={`${updates} updated`}>
          ~
          {updates}
        </span>
      )}
      {removes > 0 && (
        <span className="text-destructive" title={`${removes} removed`}>
          −
          {removes}
        </span>
      )}
    </span>
  )
}

function OperationList({ flat }: { flat: readonly FlatOp[] }) {
  const adds = flat.filter(op => op.kind === 'add')
  const updates = flat.filter(op => op.kind === 'update')
  const removes = flat.filter(op => op.kind === 'remove')
  if (flat.length === 0) {
    return (
      <p className="mx-4 mt-2 rounded-md border border-border bg-card px-3 py-2 text-2xs text-muted-foreground">
        No operations in this proposal.
      </p>
    )
  }
  return (
    <div className="h-full space-y-2 overflow-y-auto scrollbar-thin px-4 pb-4">
      {adds.length > 0 && <OperationGroup kind="add" ops={adds} />}
      {updates.length > 0 && <OperationGroup kind="update" ops={updates} />}
      {removes.length > 0 && <OperationGroup kind="remove" ops={removes} />}
    </div>
  )
}

function ViewTab({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-sm px-2 py-0.5 text-2xs font-medium uppercase tracking-wider transition-colors ${
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

interface FlatOp {
  kind: 'add' | 'update' | 'remove'
  target: 'node' | 'edge'
  id: string
  /** Type id when known (node type or edge type). */
  type?: string
  /** Short human label, e.g. node name or edge from-to. */
  label: string
  /** Optional detail, e.g. "status: draft to completed". */
  detail?: string
}

function flattenOperations(operations: readonly GraphOperation[]): FlatOp[] {
  // Each schema operation collapses to one FlatOp.
  // Batch operations such as addNodes, removeEdges, or updateNodes,
  // fan out into one FlatOp per item.
  // Keeps the list view scannable, one row per change.
  const out: FlatOp[] = []
  for (const op of operations) {
    switch (op.operation) {
      case 'addNode':
        out.push(flatAddNode(op.payload))
        break
      case 'addNodes':
        for (const n of op.payloads) out.push(flatAddNode(n))
        break
      case 'removeNode':
        out.push({ kind: 'remove', target: 'node', id: op.nodeId, label: op.nodeId })
        break
      case 'removeNodes':
        for (const id of op.nodeIds) out.push({ kind: 'remove', target: 'node', id, label: id })
        break
      case 'updateNode':
        out.push(flatUpdateNode(op.nodeId, op.patch))
        break
      case 'updateNodes':
        for (const u of op.updates) out.push(flatUpdateNode(u.nodeId, u.patch))
        break
      case 'addEdge':
        out.push(flatAddEdge(op.payload))
        break
      case 'addEdges':
        for (const e of op.payloads) out.push(flatAddEdge(e))
        break
      case 'removeEdge':
        out.push({ kind: 'remove', target: 'edge', id: op.edgeId, label: op.edgeId })
        break
      case 'removeEdges':
        for (const id of op.edgeIds) out.push({ kind: 'remove', target: 'edge', id, label: id })
        break
      case 'updateEdge':
        out.push(flatUpdateEdge(op.edgeId, op.patch))
        break
      case 'updateEdges':
        for (const u of op.updates) out.push(flatUpdateEdge(u.edgeId, u.patch))
        break
      default: {
        const exhaustive: never = op
        throw new Error(`Unhandled operation: ${JSON.stringify(exhaustive)}`)
      }
    }
  }
  return out
}

function flatAddNode(payload: GraphNodeCreate): FlatOp {
  const id = payload.id ?? '(server-minted)'
  return {
    kind: 'add',
    target: 'node',
    id,
    type: payload.type,
    label: payload.name,
    ...(payload.status ? { detail: `status=${payload.status}` } : {}),
  }
}

function flatUpdateNode(id: string, patch: Record<string, unknown>): FlatOp {
  const fields = Object.keys(patch).filter(k => k !== 'id')
  return {
    kind: 'update',
    target: 'node',
    id,
    label: id,
    ...(fields.length > 0 ? { detail: `patch: ${fields.join(', ')}` } : {}),
  }
}

function flatAddEdge(payload: GraphEdgeCreate): FlatOp {
  const id = payload.id ?? '(server-minted)'
  return {
    kind: 'add',
    target: 'edge',
    id,
    type: payload.type,
    label: `${payload.fromNodeId} → ${payload.toNodeId}`,
  }
}

function flatUpdateEdge(id: string, patch: Record<string, unknown>): FlatOp {
  const fields = Object.keys(patch).filter(k => k !== 'id')
  return {
    kind: 'update',
    target: 'edge',
    id,
    label: id,
    ...(fields.length > 0 ? { detail: `patch: ${fields.join(', ')}` } : {}),
  }
}

const OPERATION_PALETTE: Record<FlatOp['kind'], { icon: typeof PlusCircle, label: string, ring: string, text: string }> = {
  add: { icon: PlusCircle, label: 'Added', ring: 'border-emerald-500/40 bg-emerald-500/5', text: 'text-emerald-600 dark:text-emerald-400' },
  update: { icon: PencilLine, label: 'Updated', ring: 'border-amber-500/40 bg-amber-500/5', text: 'text-amber-600 dark:text-amber-400' },
  remove: { icon: MinusCircle, label: 'Removed', ring: 'border-destructive/40 bg-destructive/5', text: 'text-destructive' },
}

function OperationGroup({ kind, ops }: { kind: FlatOp['kind'], ops: readonly FlatOp[] }) {
  const palette = OPERATION_PALETTE[kind]
  const Icon = palette.icon
  return (
    <div className={`rounded-md border ${palette.ring}`}>
      <div className={`flex items-center gap-1.5 border-b border-border/50 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider ${palette.text}`}>
        <Icon className="size-3" />
        {palette.label}
        {' '}
        (
        {ops.length}
        )
      </div>
      <ul className="divide-y divide-border/50">
        {ops.map((op, idx) => (
          <li key={`${op.id}-${idx}`} className="flex items-baseline gap-2 px-3 py-1.5 text-2xs">
            <Badge variant="outline" className="text-2xs uppercase tracking-wider text-muted-foreground">
              {op.target}
              {op.type ? `:${op.type}` : ''}
            </Badge>
            <span className="truncate font-mono text-foreground">{op.label}</span>
            {op.detail && <span className="truncate text-muted-foreground">{op.detail}</span>}
            <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground/70">{op.id}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function groupBySeverity(issues: readonly ValidationIssue[]): Record<ValidationSeverity, ValidationIssue[]> {
  const groups: Record<ValidationSeverity, ValidationIssue[]> = { error: [], warning: [], info: [] }
  for (const issue of issues)
    groups[issue.severity].push(issue)
  return groups
}
