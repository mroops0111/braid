import type { Proposal } from '@telos/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
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
    return <div className="p-4 text-sm text-zinc-500">Loading proposals…</div>
  if (!data || data.items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        No pending proposals. Run /telos-extract or /telos-clarify to produce some.
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <ul className="w-96 shrink-0 overflow-y-auto scrollbar-thin border-r border-zinc-800">
        {data.items.map(proposal => (
          <li key={proposal.id}>
            <button
              type="button"
              onClick={() => setSelected(proposal)}
              className={`flex w-full flex-col gap-1 border-b border-zinc-900 px-4 py-3 text-left transition-colors hover:bg-zinc-900 ${
                selected?.id === proposal.id ? 'bg-zinc-900' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-zinc-100">{proposal.id}</span>
                <Badge variant="pending">{proposal.status}</Badge>
              </div>
              <div className="text-xs text-zinc-500">
                {proposal.operations.length}
                {' '}
                ops • by
                {proposal.generatedBy}
              </div>
              <div className="line-clamp-2 text-xs text-zinc-400">{proposal.rationale}</div>
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
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
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
      <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div className="flex-1">
          <div className="font-mono text-xs text-zinc-500">{proposal.id}</div>
          <div className="text-sm font-medium text-zinc-100">{proposal.rationale}</div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={apply.isPending}
            onClick={() => apply.mutate()}
          >
            <Check className="h-3 w-3" />
            {' '}
            Apply
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={reject.isPending}
            onClick={() => reject.mutate('Rejected from Studio')}
          >
            <X className="h-3 w-3" />
            {' '}
            Reject
          </Button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <h3 className="px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Operations (
          {proposal.operations.length}
          )
        </h3>
        <pre className="mx-4 mb-4 overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
          {JSON.stringify(proposal.operations, null, 2)}
        </pre>
        {(apply.error || reject.error) && (
          <div className="mx-4 mb-3 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {((apply.error ?? reject.error) as Error).message}
          </div>
        )}
      </div>
    </div>
  )
}
