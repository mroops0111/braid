import type { Proposal } from '@telos/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { queryKeys, usePendingProposals } from '@/lib/queries'

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
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No pending proposals. Run /telos-extract or /telos-clarify to produce some.
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <ul className="w-96 shrink-0 overflow-y-auto scrollbar-thin border-r border-border">
        {data.items.map(proposal => (
          <li key={proposal.id} className="relative">
            {selected?.id === proposal.id && (
              <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
            )}
            <button
              type="button"
              onClick={() => setSelected(proposal)}
              className={`flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors duration-150 hover:bg-accent ${
                selected?.id === proposal.id ? 'bg-accent' : ''
              }`}
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
            </button>
          </li>
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
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a proposal.
              </div>
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex-1">
          <div className="font-mono text-xs text-muted-foreground">{proposal.id}</div>
          <div className="text-sm font-medium text-foreground">{proposal.rationale}</div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={apply.isPending}
            onClick={() => apply.mutate()}
          >
            <Check />
            Apply
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={reject.isPending}
            onClick={() => reject.mutate('Rejected from Studio')}
          >
            <X />
            Reject
          </Button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
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
