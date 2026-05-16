import type { Proposal, ValidationIssue, ValidationSeverity } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, Check, Inbox, Info, X } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { queryKeys, usePendingProposals, useProposalValidation } from '@/lib/queries'

interface ProposalsPageProps {
  workspaceId: string
}

const DEFAULT_USER_ID = 'studio-user'

export function ProposalsPage({ workspaceId }: ProposalsPageProps) {
  const { data, isLoading } = usePendingProposals(workspaceId)
  const [selected, setSelected] = useState<Proposal | null>(null)

  if (isLoading)
    return <div className="p-4 text-sm text-muted-foreground">Loading proposals…</div>
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No Pending Proposals"
        description="Run /braid-extract or /braid-clarify to produce graph mutations awaiting HITL review."
      />
    )
  }

  return (
    <div className="flex h-full">
      <ul className="w-96 shrink-0 overflow-y-auto scrollbar-thin border-r border-border">
        {data.items.map(proposal => (
          <ListRow
            key={proposal.id}
            active={selected?.id === proposal.id}
            onClick={() => setSelected(proposal)}
            className="flex-col gap-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-foreground">{proposal.id}</span>
              <StatusBadge status={proposal.status} />
            </div>
            <div className="text-xs text-muted-foreground">
              {proposal.operations.length}
              {' '}
              ops · by
              {' '}
              {proposal.generatedBy}
            </div>
            <div className="line-clamp-2 text-xs text-foreground/80">{proposal.rationale}</div>
          </ListRow>
        ))}
      </ul>
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
                title="Pick a Proposal"
                description="Select a proposal on the left to review the operations and apply or reject it."
              />
            )}
      </div>
    </div>
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

  const validation = useProposalValidation(workspaceId, proposal.id)
  const errorCount = validation.data?.issues.filter(issue => issue.severity === 'error').length ?? 0
  const blockedByErrors = errorCount > 0

  const apply = useMutation({
    mutationFn: () => api.applyProposal(workspaceId, proposal.id, DEFAULT_USER_ID),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proposals(workspaceId, 'pending') })
      queryClient.invalidateQueries({ queryKey: queryKeys.modelSnapshot(workspaceId) })
      onComplete()
    },
  })

  const reject = useMutation({
    mutationFn: (reason: string) => api.rejectProposal(workspaceId, proposal.id, reason, DEFAULT_USER_ID),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proposals(workspaceId, 'pending') })
      onComplete()
    },
  })

  const applyTitle = blockedByErrors
    ? `Cannot apply: ${errorCount} validation error${errorCount === 1 ? '' : 's'} must be resolved first.`
    : undefined

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex-1">
          <div className="font-mono text-xs text-muted-foreground">{proposal.id}</div>
          <div className="text-sm font-medium text-foreground">{proposal.rationale}</div>
        </div>
        <div className="flex gap-2">
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
        </div>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <ValidationPanel
          isLoading={validation.isLoading}
          error={validation.error}
          issues={validation.data?.issues ?? []}
          ok={validation.data?.ok ?? null}
        />

        {rejectOpen && (
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

        <h3 className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Operations (
          {proposal.operations.length}
          )
        </h3>
        <pre className="mx-4 mb-4 overflow-x-auto rounded-md border border-border bg-card p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
          {JSON.stringify(proposal.operations, null, 2)}
        </pre>
        {(apply.error || reject.error) && (
          <div className="mx-4 mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {((apply.error ?? reject.error) as Error).message}
          </div>
        )}
      </div>
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
    return <p className="px-4 pt-3 text-[11px] text-muted-foreground">Validating against the current graph…</p>
  }
  if (error) {
    return (
      <p className="mx-4 mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
        Validation request failed:
        {' '}
        {error instanceof Error ? error.message : String(error)}
      </p>
    )
  }
  if (ok && issues.length === 0) {
    return (
      <p className="mx-4 mt-3 rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
        No validation issues. Safe to apply.
      </p>
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
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${palette.text}`}>
        <Icon className="size-3" />
        {severity}
        {' '}
        (
        {issues.length}
        )
      </div>
      <ul className="mt-1.5 space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`} className="text-[11px] text-foreground/90">
            <span className="font-mono text-foreground/60">
              [
              {issue.code}
              ]
            </span>
            {' '}
            {issue.message}
            {(issue.nodeId || issue.edgeId || issue.path) && (
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                →
                {' '}
                {issue.nodeId ?? issue.edgeId ?? issue.path}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
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
      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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

function groupBySeverity(issues: readonly ValidationIssue[]): Record<ValidationSeverity, ValidationIssue[]> {
  const groups: Record<ValidationSeverity, ValidationIssue[]> = { error: [], warning: [], info: [] }
  for (const issue of issues)
    groups[issue.severity].push(issue)
  return groups
}
