import type { Clarification, Proposal } from '@braidhq/schema'
import { Inbox as InboxIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { StatusBadge } from '@/components/StatusBadge'
import { SurfaceLayout } from '@/components/SurfaceLayout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useClarificationByStatus, useProposalsByStatus } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { ClarificationDetail, questionExcerpt } from './Clarification'
import { ProposalDetail } from './Proposals'

/**
 * One waiting thing, whichever kind it is.
 *
 * The list is shared because a reviewer asks one question of it, what needs me.
 * The detail is not, because answering a question and reviewing a diff are
 * different acts, and collapsing them into one shape would serve neither.
 */
type Item =
  | { readonly kind: 'clarification', readonly id: string, readonly at: string, readonly record: Clarification }
  | { readonly kind: 'proposal', readonly id: string, readonly at: string, readonly record: Proposal }

type KindFilter = 'all' | 'clarification' | 'proposal'

export function InboxPage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<KindFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const clarifications = useClarificationByStatus(workspaceId, 'pending')
  const proposals = useProposalsByStatus(workspaceId, 'pending')
  const isLoading = clarifications.isLoading || proposals.isLoading

  const items = useMemo<Item[]>(() => {
    const asked: Item[] = (clarifications.data?.items ?? []).map(record => ({
      kind: 'clarification',
      id: record.id,
      // A clarification carries no raised-at of its own, so the id's own
      // ordering stands in, which is the order they were minted.
      at: record.id,
      record,
    }))
    const proposed: Item[] = (proposals.data?.items ?? []).map(record => ({
      kind: 'proposal',
      id: record.id,
      at: record.generatedAt,
      record,
    }))
    return [...asked, ...proposed].sort((a, b) => b.at.localeCompare(a.at))
  }, [clarifications.data, proposals.data])

  const shown = kind === 'all' ? items : items.filter(item => item.kind === kind)
  const selected = shown.find(item => item.id === selectedId) ?? null

  // Land on something rather than an empty pane, and re-land after answering
  // clears the current one. Working a queue should not cost a click per item.
  useEffect(() => {
    if (selected || isLoading || shown.length === 0)
      return
    setSelectedId(shown[0]!.id)
  }, [selected, isLoading, shown])

  const askedCount = items.filter(item => item.kind === 'clarification').length
  const proposedCount = items.length - askedCount

  return (
    <SurfaceLayout
      list={(
        <>
          <div className="border-b border-border px-3 pt-3">
            <Tabs value={kind} onValueChange={value => setKind(value as KindFilter)}>
              <TabsList variant="line">
                <TabsTrigger value="all">{t('inbox.filter.all', { count: items.length })}</TabsTrigger>
                <TabsTrigger value="clarification">{t('inbox.filter.asked', { count: askedCount })}</TabsTrigger>
                <TabsTrigger value="proposal">{t('inbox.filter.proposed', { count: proposedCount })}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <ul className="flex-1 overflow-y-auto scrollbar-thin">
            {shown.map(item => (
              <InboxRow
                key={item.id}
                item={item}
                active={item.id === selectedId}
                onSelect={() => setSelectedId(item.id)}
              />
            ))}
          </ul>
        </>
      )}
    >
      {selected === null
        ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={InboxIcon}
                title={t('inbox.emptyTitle')}
                description={t('inbox.emptyDescription')}
              />
            </div>
          )
        : selected.kind === 'clarification'
          ? (
              <ClarificationDetail
                workspaceId={workspaceId}
                ticket={selected.record}
                onComplete={() => setSelectedId(null)}
              />
            )
          : (
              <ProposalDetail
                workspaceId={workspaceId}
                proposal={selected.record}
                onComplete={() => setSelectedId(null)}
              />
            )}
    </SurfaceLayout>
  )
}

/** A run that raised this is one a person can answer back into. */
function InboxRow({ item, active, onSelect }: { item: Item, active: boolean, onSelect: () => void }) {
  const { t } = useTranslation()
  const asked = item.kind === 'clarification'
  const title = asked
    ? questionExcerpt((item.record as Clarification).question)
    : (item.record as Proposal).rationale
  const source = asked
    ? (item.record as Clarification).skillRunId
    : (item.record as Proposal).generatedBy

  return (
    <ListRow active={active} onClick={onSelect} {...(active ? { stripeClassName: 'bg-primary' } : {})}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <StatusBadge status={asked ? 'asked' : 'pending'} />
          {source && (
            <span className="truncate font-mono text-2xs text-muted-foreground">{source}</span>
          )}
        </div>
        <span className={cn('line-clamp-2 text-xs', active ? 'text-foreground' : 'text-foreground/85')}>
          {title || t('inbox.untitled')}
        </span>
      </div>
    </ListRow>
  )
}
