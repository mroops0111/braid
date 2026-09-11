import type { Clarification, CoverageStage, Locale, ProposalId } from '@braidhq/schema'
import type { TranslationKey } from '@/lib/i18n'
import type { Item } from '@/lib/inboxItems'
import { localize } from '@braidhq/schema'
import { Inbox as InboxIcon, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RunBlocks } from '@/components/blocks/RunBlocks'
import { EmptyState } from '@/components/EmptyState'
import { ListRow, ListRowTitle } from '@/components/ListRow'
import { RunTranscript } from '@/components/RunTranscript'
import { SurfaceBand } from '@/components/SurfaceBand'
import { CollapseListButton, SurfaceLayout } from '@/components/SurfaceLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { TRANSCRIPT_VIEW } from '@/lib/blocks/audience'
import { buildItems } from '@/lib/inboxItems'
import { useClarificationByStatus, useCoverage, useProposalsByStatus } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useRun } from '@/lib/useRun'

import { ClarificationDetail, questionExcerpt } from './Clarification'
import { ProposalDetail } from './Proposals'

type KindFilter = 'all' | 'asked' | 'proposal'

/**
 * What the reader is looking at, not how they look at it.
 *
 * Stacking the run's working above the record cost both of them room,
 * and on a clarification it pushed the answer button off the bottom.
 * They are two things a reviewer wants one at a time,
 * the thing to decide and the reasoning behind it,
 * so each takes the pane rather than half of it.
 */
type DetailView = 'record' | 'reasoning' | typeof TRANSCRIPT_VIEW

export function InboxPage({ workspaceId, focusedProposalId, onFocusConsumed }: {
  workspaceId: string
  /** A proposal named from another surface, selected once and then let go. */
  focusedProposalId?: ProposalId | null
  onFocusConsumed?: () => void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<KindFilter>('all')
  const [listOpen, setListOpen] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const clarifications = useClarificationByStatus(workspaceId, 'pending')
  const answered = useClarificationByStatus(workspaceId, 'answered')
  const proposals = useProposalsByStatus(workspaceId, 'pending')
  const coverage = useCoverage(workspaceId)
  const isLoading = clarifications.isLoading || proposals.isLoading

  const items = useMemo<Item[]>(() => buildItems({
    pending: clarifications.data?.items ?? [],
    proposals: proposals.data?.items ?? [],
    running: (coverage.data?.cards ?? []).filter(card => card.state === 'running'),
  }), [clarifications.data, proposals.data, coverage.data])

  const shown = kind === 'all' ? items : items.filter(item => matchesFilter(item, kind))
  const selected = shown.find(item => item.id === selectedId) ?? null

  // A deep link outranks landing on the first item, and is consumed once,
  // so the reader is free to move on without being dragged back.
  useEffect(() => {
    if (!focusedProposalId)
      return
    if (!items.some(item => item.id === focusedProposalId))
      return
    setKind('all')
    setSelectedId(focusedProposalId)
    onFocusConsumed?.()
  }, [focusedProposalId, items, onFocusConsumed])

  // Land on something rather than an empty pane,
  // and re-land after answering clears the current one.
  // Working a queue should not cost a click per item.
  useEffect(() => {
    if (selected || isLoading || shown.length === 0)
      return
    setSelectedId(shown[0]!.id)
  }, [selected, isLoading, shown])

  /**
   * Carry the run on, once nothing of its is still open.
   *
   * Answering, deferring, and setting aside all release it,
   * because the run asked in order to keep going,
   * and every one of those is a decision it can go on from.
   * What it is told each was is the server's to say,
   * read off the record rather than sent from here.
   *
   * A run parked on three questions is parked on all three,
   * so settling the first must not restart it,
   * and strand the other two pointing at a conversation that has moved.
   * Asked of the server rather than of the cache,
   * because the decision that triggered this is what makes the cache wrong,
   * for exactly as long as it takes to refetch.
   */
  const continueRun = useCallback((ticket: Clarification) => {
    const runId = ticket.skillRunId
    if (!runId || ticket.answerMode !== 'resumes')
      return
    void (async () => {
      const remaining = await api.listClarification(workspaceId, 'pending')
      const stillOpen = remaining.items.some(
        item => item.skillRunId === runId && item.answerMode === 'resumes',
      )
      if (stillOpen)
        return
      await runStore.resumeAfterAnswer({
        workspaceId,
        skillId: 'inbox',
        threadId: runId,
        clarificationId: ticket.id,
      })
    })().catch(() => {
      // The decision is recorded either way,
      // so nothing is lost that a person has to enter again.
      // An answer a run cannot take up is still the clarify skill's to pick up.
      // A deferral or a set-aside is not, and that run stays stopped,
      // which nothing here can currently say.
    })
  }, [workspaceId])

  const askedCount = items.filter(item => item.kind === 'parked' || item.kind === 'question').length
  const proposedCount = items.filter(item => item.kind === 'proposal').length
  const waitingOnClarify = answered.data?.items.length ?? 0

  return (
    // The height context SurfaceLayout needs.
    // Without it the pane lays out at its content height,
    // and anything pinned to the bottom of a detail ends up below the fold.
    <div className="flex h-full flex-col">
      <SurfaceLayout
        collapse={{ collapsed: !listOpen, onToggle: next => setListOpen(!next), showLabel: t('common.showList') }}
        list={(
          <>
            <SurfaceBand trailing={<CollapseListButton label={t('common.hideList')} onCollapse={() => setListOpen(false)} />}>
              <Tabs value={kind} onValueChange={value => setKind(value as KindFilter)}>
                <TabsList variant="line">
                  <TabsTrigger value="all">{t('inbox.filter.all', { count: items.length })}</TabsTrigger>
                  <TabsTrigger value="asked">{t('inbox.filter.asked', { count: askedCount })}</TabsTrigger>
                  <TabsTrigger value="proposal">{t('inbox.filter.proposed', { count: proposedCount })}</TabsTrigger>
                </TabsList>
              </Tabs>
            </SurfaceBand>
            <ul className="flex-1 overflow-y-auto scrollbar-thin">
              {shown.map(item => (
                <InboxRow
                  key={item.id}
                  item={item}
                  stageLabels={coverage.data?.stages ?? []}
                  active={item.id === selectedId}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))}
            </ul>
            {waitingOnClarify > 0 && (
              // Answering a standing question changes nothing on its own.
              // The step that reads answered ones has to be run,
              // and somebody who just worked a queue is who needs telling.
              <p className="shrink-0 border-t border-border px-3 py-2 text-2xs text-muted-foreground">
                {t('inbox.answeredWaiting', { count: waitingOnClarify })}
              </p>
            )}
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
                onSettled={continueRun}
              />
            )}
      </SurfaceLayout>
    </div>
  )
}

function matchesFilter(item: Item, filter: Exclude<KindFilter, 'all'>): boolean {
  return filter === 'asked'
    ? item.kind === 'parked' || item.kind === 'question'
    : item.kind === 'proposal'
}

/**
 * One waiting item, and the two ways of looking at it.
 *
 * Keyed by the item, so which view is open belongs to the item,
 * rather than to the pane.
 * Held above, it survived into the next item,
 * and resetting it from an effect fought every re-selection the list made.
 */
function ItemDetail({ workspaceId, item, onComplete, onSettled }: {
  workspaceId: string
  item: Item
  onComplete: () => void
  onSettled: (ticket: Clarification) => void
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<DetailView>(item.kind === 'running' ? 'reasoning' : 'record')
  // Which of a parked run's questions is open.
  // The run is one item, so moving between its questions,
  // must not move the reader off it.
  const [questionId, setQuestionId] = useState<string | null>(null)
  // A running item and a parked one are keyed by the run itself.
  // Everything else names the run that produced it.
  const runId = item.kind === 'running' || item.kind === 'parked' ? item.id : item.record.skillRunId
  const run = useRun(workspaceId, runId ?? null)
  const events = run?.events ?? []

  useEffect(() => {
    if (runId)
      runStore.loadRun(workspaceId, runId, 'inbox')
  }, [workspaceId, runId])

  const openQuestion = item.kind === 'parked'
    ? item.questions.find(question => question.id === questionId) ?? item.questions[0]!
    : item.kind === 'question' ? item.record : null

  // The same control the Ask surface uses, in the same place,
  // the header row beside whatever the record can be done to.
  // One band rather than two, and the choice does not move with the view.
  const viewToggle = (
    <Tabs value={view} onValueChange={value => setView(value as DetailView)}>
      <TabsList variant="line">
        {item.kind !== 'running' && (
          <TabsTrigger value="record">
            {t(item.kind === 'proposal' ? 'inbox.view.change' : 'inbox.view.question')}
          </TabsTrigger>
        )}
        <TabsTrigger value="reasoning">
          {t(item.kind === 'running' ? 'inbox.view.live' : 'inbox.view.reasoning')}
        </TabsTrigger>
        <TabsTrigger value={TRANSCRIPT_VIEW} className="gap-1.5">
          {t('ask.view.transcript')}
          {events.length > 0 && <span className="font-mono text-muted-foreground/60">{events.length}</span>}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SurfaceBand className="px-4">{viewToggle}</SurfaceBand>
      {item.kind === 'parked' && item.questions.length > 1 && view === 'record' && (
        // One run, several doubts.
        // They are answered together, so they share an item,
        // and this is how a reader moves between them,
        // without losing their place in the queue.
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-border px-4 py-2">
          {item.questions.map((question, index) => (
            <Button
              key={question.id}
              size="xs"
              variant={question.id === openQuestion?.id ? 'secondary' : 'ghost'}
              className="text-2xs"
              onClick={() => setQuestionId(question.id)}
            >
              {t('inbox.questionIndex', { index: index + 1 })}
            </Button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {view === TRANSCRIPT_VIEW
          ? (
              <RunTranscript workspaceId={workspaceId} runId={runId} />
            )
          : view === 'reasoning'
            ? (
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                  <RunBlocks workspaceId={workspaceId} runId={runId} />
                </div>
              )
            : openQuestion
              ? (
                  <ClarificationDetail
                    key={openQuestion.id}
                    workspaceId={workspaceId}
                    ticket={openQuestion}
                    onComplete={item.kind === 'parked' && item.questions.length > 1 ? () => {} : onComplete}
                    onSettled={onSettled}
                  />
                )
              : item.kind === 'proposal'
                ? (
                    <ProposalDetail
                      workspaceId={workspaceId}
                      proposal={item.record}
                      onComplete={onComplete}
                    />
                  )
                : null}
      </div>
    </div>
  )
}

function InboxRow({ item, active, onSelect, stageLabels }: {
  item: Item
  active: boolean
  onSelect: () => void
  /** What the ontology calls each step, so no row shows a skill id. */
  stageLabels: readonly CoverageStage[]
}) {
  const { t } = useTranslation()
  const { i18n } = useTranslation()
  const { label, title, source } = describe(item, stageLabels, i18n.language)

  return (
    <ListRow active={active} onClick={onSelect} {...(active ? { stripeClassName: 'bg-primary' } : {})}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          {/* Kind, not status. Everything here is pending, and a badge that
              said so on every row would carry no information at all. */}
          <Badge variant="outline" className="shrink-0 text-2xs uppercase">
            {item.kind === 'running' && <Loader2 className="mr-1 size-2.5 animate-spin" />}
            {t(label)}
          </Badge>
          {source && (
            <span className="truncate font-mono text-2xs text-muted-foreground">{source}</span>
          )}
        </div>
        <ListRowTitle {...(active ? { className: 'text-foreground' } : {})}>
          {title || t('inbox.untitled')}
        </ListRowTitle>
      </div>
    </ListRow>
  )
}

function nameStep(skillId: string | undefined, stages: readonly CoverageStage[], locale: string): string | undefined {
  if (!skillId)
    return undefined
  const stage = stages.find(item => item.skillId === skillId)
  return stage?.label ? localize(stage.label, locale as Locale) : skillId
}

function describe(
  item: Item,
  stages: readonly CoverageStage[],
  locale: string,
): { label: TranslationKey, title: string, source: string | undefined } {
  switch (item.kind) {
    case 'running':
      return { label: 'inbox.kind.running', title: item.card.name, source: nameStep(item.card.lastRun?.skillId, stages, locale) }
    case 'parked':
      return {
        label: item.questions.length > 1 ? 'inbox.kind.questions' : 'inbox.kind.question',
        title: item.questions.map(question => questionExcerpt(question.question)).join(' · '),
        source: item.id,
      }
    case 'question':
      // No source, because a standing question has nothing parked on it,
      // and naming the run that raised it would say otherwise.
      return { label: 'inbox.kind.question', title: questionExcerpt(item.record.question), source: undefined }
    case 'proposal':
      return { label: 'inbox.kind.change', title: item.record.rationale, source: nameStep(item.record.generatedBy, stages, locale) }
    default: {
      const exhaustive: never = item
      throw new Error(`Unhandled inbox item: ${JSON.stringify(exhaustive)}`)
    }
  }
}
