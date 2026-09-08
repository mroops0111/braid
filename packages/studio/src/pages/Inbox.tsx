import type { Clarification, Proposal } from '@braidhq/schema'
import { Inbox as InboxIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RunBlocks } from '@/components/blocks/RunBlocks'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { SurfaceLayout } from '@/components/SurfaceLayout'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useClarificationByStatus, useProposalsByStatus } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
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
  | { readonly kind: 'clarification', readonly id: string, readonly at?: undefined, readonly record: Clarification }
  | { readonly kind: 'proposal', readonly id: string, readonly at: string, readonly record: Proposal }

type KindFilter = 'all' | 'clarification' | 'proposal'

/**
 * What the reader is looking at, not how they look at it.
 *
 * Stacking the run's working above the record cost both of them room, and on a
 * clarification it pushed the answer button off the bottom. They are two
 * things a reviewer wants one at a time, the thing to decide and the reasoning
 * behind it, so each takes the pane rather than half of it.
 */
type DetailView = 'record' | 'reasoning'

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
      record,
    }))
    const proposed: Item[] = (proposals.data?.items ?? []).map(record => ({
      kind: 'proposal',
      id: record.id,
      at: record.generatedAt,
      record,
    }))
    // Questions first, since a run is waiting on each of them, then changes
    // newest first. A clarification carries no raised-at to sort by, and
    // ordering the two kinds against each other by anything else would be
    // inventing a sequence the records do not have.
    return [...asked, ...proposed.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))]
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

  // Answering is what lets the run carry on, so it starts here rather than
  // waiting for anyone to notice it could. A clarification nobody's run raised
  // has nothing to continue, and the answer simply stands on its own.
  const continueRun = useCallback((ticket: Clarification) => {
    if (!ticket.skillRunId)
      return
    void runStore.resumeAfterAnswer({
      workspaceId,
      skillId: 'inbox',
      threadId: ticket.skillRunId,
      clarificationId: ticket.id,
    }).catch(() => {
      // The answer is recorded either way. A run that cannot be continued is
      // the clarify skill's to pick up, which is what it is still there for.
    })
  }, [workspaceId])

  const askedCount = items.filter(item => item.kind === 'clarification').length
  const proposedCount = items.length - askedCount

  return (
    // The height context SurfaceLayout needs. Without it the pane lays out at
    // its content height, and anything pinned to the bottom of a detail, the
    // answer button among them, ends up below the fold.
    <div className="flex h-full flex-col">
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
          : (
              <ItemDetail
                key={selected.id}
                workspaceId={workspaceId}
                item={selected}
                onComplete={() => setSelectedId(null)}
                onAnswered={continueRun}
              />
            )}
      </SurfaceLayout>
    </div>
  )
}

/**
 * One waiting item, and the two ways of looking at it.
 *
 * Keyed by the item, so which view is open belongs to the item rather than to
 * the pane. Held above, it survived into the next item, and resetting it from
 * an effect fought every re-selection the list made on its own.
 */
function ItemDetail({ workspaceId, item, onComplete, onAnswered }: {
  workspaceId: string
  item: Item
  onComplete: () => void
  onAnswered: (ticket: Clarification) => void
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<DetailView>('record')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-4">
        <Tabs value={view} onValueChange={value => setView(value as DetailView)}>
          <TabsList variant="line">
            <TabsTrigger value="record">
              {t(item.kind === 'clarification' ? 'inbox.view.question' : 'inbox.view.change')}
            </TabsTrigger>
            <TabsTrigger value="reasoning">{t('inbox.view.reasoning')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {view === 'reasoning'
          ? (
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                <RunBlocks workspaceId={workspaceId} runId={item.record.skillRunId} />
              </div>
            )
          : item.kind === 'clarification'
            ? (
                <ClarificationDetail
                  workspaceId={workspaceId}
                  ticket={item.record}
                  onComplete={onComplete}
                  onAnswered={onAnswered}
                />
              )
            : (
                <ProposalDetail
                  workspaceId={workspaceId}
                  proposal={item.record}
                  onComplete={onComplete}
                />
              )}
      </div>
    </div>
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
          {/* Kind, not status. Both of these are pending, and a badge that
              said so on every row would carry no information at all. */}
          <Badge variant="outline" className="shrink-0 text-2xs uppercase">
            {t(asked ? 'inbox.kind.question' : 'inbox.kind.change')}
          </Badge>
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
