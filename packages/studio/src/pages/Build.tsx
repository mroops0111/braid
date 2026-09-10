import type { CoverageBoard, CoverageCard, CoverageStage, CoverageState, Locale, ProposalId } from '@braidhq/schema'
import { localize } from '@braidhq/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronRight, ClipboardCheck, ExternalLink, FileText, MessageCircleQuestion, Network, Play } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RunBlocks } from '@/components/blocks/RunBlocks'
import { DetailFact, DetailPanel, SectionTitle } from '@/components/DetailPanel'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { RunTranscript } from '@/components/RunTranscript'
import { StatusBadge, statusDot, statusTone } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { TRANSCRIPT_VIEW } from '@/lib/blocks/audience'
import { summariseActivity } from '@/lib/blocks/runActivity'
import { useLocaleFormat } from '@/lib/i18n/datetime'
import { useBatchStatus, useCoverage, useSkills } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useGraphNavigation } from '@/lib/useGraphNavigation'
import { useRun } from '@/lib/useRun'
import { useTabNavigation } from '@/lib/useTabNavigation'
import { cn } from '@/lib/utils'
import { useWorkspacePolicy } from '@/policy'

/**
 * The order a reader meets the groups in, which is how directly each can be
 * acted on. Deliberately not the precedence order: that one settles which
 * state a document shows when several are true, and answers a different
 * question from which group deserves the top of the page.
 *
 * Conflicts sit low despite mattering, because nothing here resolves one yet.
 * Putting them above the groups a button does fix would bury those behind
 * dozens of rows that only ask to be read.
 */
const GROUPS: readonly CoverageState[] = [
  'running',
  'awaitingDecision',
  'failed',
  'sourceChanged',
  'uncovered',
  'conflicted',
  'covered',
]

/** Where running the per-unit step is the answer, so the group offers it. */
const ACTIONABLE: ReadonlySet<CoverageState> = new Set<CoverageState>(['uncovered', 'sourceChanged', 'failed'])

/**
 * Every source document, and what the model has made of it.
 *
 * The row is the document, not the run, because the question a reader opens
 * this with is what the model still does not know rather than what has
 * executed. A document read three times and failed twice is one row.
 *
 * Grouped rather than columned. Nothing here is dragged, the states are
 * derived, and two of them hold almost every document, so lanes of equal
 * width would spend most of the board on groups that are empty and force a
 * second scroll axis to reach the ones that are not.
 *
 * The groups are mechanical and hold for any ontology. The steps across the
 * top are the ontology's own, read from what it declared, so swapping one
 * changes the pipeline here and nothing else.
 */
export function BuildPage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const coverage = useCoverage(workspaceId)
  const { data: skillsData } = useSkills(workspaceId)
  const policy = useWorkspacePolicy(workspaceId)
  const navigation = useTabNavigation()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const board = coverage.data
  const cards = board?.cards ?? []
  const selected = cards.find(card => keyOf(card) === selectedKey) ?? null
  const unitStage = board?.stages.find(stage => !stage.global)
  // Permission belongs to the skill, and the manifest is where a workspace
  // records who may run it, so a stage id alone cannot answer the question.
  const mayRun = (skillId: string | undefined): boolean => {
    const manifest = (skillsData?.items ?? []).find(skill => skill.id === skillId)
    return manifest !== undefined && policy.can('skill.run', { skill: manifest.frontmatter, skillId: manifest.id })
  }
  const mayRunUnits = mayRun(unitStage?.skillId)
  const { data: activePlan } = useBatchStatus(workspaceId)
  // One build at a time, because the graph only accumulates. The server
  // refuses a second, so the surface stops offering one rather than letting a
  // person find out by error. A batch that has not spawned its first run yet
  // counts too, since it is about to.
  const busy = (board?.building ?? false)
    || activePlan?.status === 'running'
    || activePlan?.status === 'deriving'
  const [covering, setCovering] = useState<readonly CoverageCard[] | null>(null)

  const groups = useMemo(
    () => GROUPS
      .map(state => ({ state, cards: cards.filter(card => card.state === state) }))
      .filter(group => group.cards.length > 0),
    [cards],
  )

  if (coverage.isLoading)
    return <div className="p-5 text-xs text-muted-foreground">{t('build.loading')}</div>

  if (cards.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={t('build.emptyTitle')}
        description={t('build.emptyDescription')}
      />
    )
  }

  return (
    // The height context the groups scroll inside. Without it the list lays
    // out at its content height and the surface clips it with no way down.
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <StageStrip
          board={board!}
          workspaceId={workspaceId}
          canRun={skillId => mayRun(skillId) && !busy}
          busy={busy}
          onOpenInbox={() => navigation?.openInbox()}
        />
        <CoverageRibbon cards={cards} busy={busy} selectedKey={selectedKey} onSelect={setSelectedKey} />
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {groups.map(group => (
            <Group
              key={group.state}
              workspaceId={workspaceId}
              state={group.state}
              cards={group.cards}
              stage={unitStage}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onRunAll={unitStage && mayRunUnits && !busy && ACTIONABLE.has(group.state)
                ? () => setCovering(group.cards)
                : undefined}
            />
          ))}
        </div>
      </div>
      {covering && (
        <CoverDialog
          workspaceId={workspaceId}
          cards={covering}
          skillId={unitStage!.skillId}
          onClose={() => setCovering(null)}
        />
      )}
      {selected && (
        <CardDetail
          key={keyOf(selected)}
          workspaceId={workspaceId}
          card={selected}
          stage={unitStage}
          stages={board?.stages ?? []}
          canRun={mayRunUnits && !busy}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  )
}

/**
 * Covering a group, which is a batch.
 *
 * One plan rather than a loop of runs, because a loop has no order, no
 * checkpoint, and nothing to resume from, and forty documents would start
 * forty subprocesses at once. The plan is the same one a first bootstrap
 * builds, scoped to these documents.
 *
 * Applying without review is the thing that makes a bootstrap fast, and it is
 * also the thing that puts unreviewed work in the graph, so it is asked here
 * rather than assumed either way.
 */
function CoverDialog({ workspaceId, cards, skillId, onClose }: {
  workspaceId: string
  cards: readonly CoverageCard[]
  skillId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [autoApply, setAutoApply] = useState(false)

  const start = useMutation({
    mutationFn: () => api.startBatch(workspaceId, autoApply, cards.map(card => card.path)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId], refetchType: 'active' })
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('build.cover.title', { count: cards.length })}</DialogTitle>
          <DialogDescription>{t('build.cover.description', { skill: skillId })}</DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 rounded-md border border-border p-3 text-xs">
          <input
            type="checkbox"
            checked={autoApply}
            onChange={event => setAutoApply(event.target.checked)}
            className="mt-0.5 size-3.5 accent-primary"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">{t('build.cover.autoApply')}</span>
            <span className="text-2xs text-muted-foreground">{t('build.cover.autoApplyHint')}</span>
          </span>
        </label>
        {start.error !== null && (
          <p className="text-xs text-destructive">
            {start.error instanceof Error ? start.error.message : String(start.error)}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? t('build.cover.starting') : t('build.cover.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * What to call a step, in the reader's language.
 *
 * A skill id is an address. The ontology declares what its steps are called
 * and localises it the way it localises its node types, so a board that shows
 * the id is showing plumbing. Falls back to the id, which is at least true.
 */
function stageLabel(stage: CoverageStage | undefined, locale: string): string {
  if (!stage)
    return ''
  return stage.label ? localize(stage.label, locale as Locale) : stage.skillId
}

function keyOf(card: CoverageCard): string {
  return `${card.sourceId} ${card.path}`
}

/**
 * The ontology's own pipeline, and where each step stands.
 *
 * Two kinds of step sit here and they are marked apart, because a reader who
 * cannot tell them apart cannot tell why only some of them carry a button. A
 * per-document step is run from a row or a group. A graph-wide step is run
 * from here, since it belongs to no document.
 *
 * Narrow on purpose: it says which steps exist and what each is waiting on. It
 * is not a canvas, because nobody edits the pipeline.
 */
function StageStrip({ board, workspaceId, canRun, busy, onOpenInbox }: {
  board: CoverageBoard
  workspaceId: string
  canRun: (skillId: string) => boolean
  busy: boolean
  onOpenInbox: () => void
}) {
  const { t } = useTranslation()
  const inModel = board.cards.filter(card => card.nodeIds.length > 0).length

  return (
    <header className="flex shrink-0 items-stretch bg-sidebar">
      {board.stages.map(stage => (
        <StageCell
          key={stage.skillId}
          stage={stage}
          workspaceId={workspaceId}
          canRun={canRun(stage.skillId)}
          busy={busy}
          onOpenInbox={onOpenInbox}
          standing={stage.global ? undefined : t('build.coveredOf', { done: inModel, total: board.cards.length })}
        />
      ))}
    </header>
  )
}

/**
 * One step, and the reason to press it now.
 *
 * The reason is a fact the server already holds, never a prompt to guess at:
 * how many answers are queued for the step that reads them, or when the step
 * last ran. A step with no reason is still shown, because a pipeline missing
 * a stage reads as a broken pipeline.
 */
function StageCell({ stage, workspaceId, canRun, busy, onOpenInbox, standing }: {
  stage: CoverageStage
  workspaceId: string
  canRun: boolean
  busy: boolean
  onOpenInbox: () => void
  standing?: string | undefined
}) {
  const { t, i18n } = useTranslation()
  const { formatRelativeTime } = useLocaleFormat()
  const waiting = stage.proposalIds.length + stage.clarificationIds.length
  // Nothing answered means the run would read an empty queue and cost a
  // subprocess to say so, which is why the button goes flat rather than eager.
  const idle = stage.readsAnswered && stage.answeredIds.length === 0

  const reason = standing
    ?? (stage.readsAnswered
      ? (idle ? t('build.stage.noneAnswered') : t('build.stage.answeredWaiting', { count: stage.answeredIds.length }))
      : stage.lastRun
        ? t('build.stage.lastRunAt', { when: formatRelativeTime(stage.lastRun.startedAt) })
        : t('build.stage.neverRun'))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 border-r border-border px-4 py-2.5 last:border-r-0">
      <div className="flex items-baseline gap-2">
        <Badge variant="outline" className={cn('text-2xs', stage.global && 'border-primary/40 text-primary')}>
          {t(stage.global ? 'build.stage.graphWide' : 'build.stage.perDocument')}
        </Badge>
        <span className="truncate text-xs font-medium text-foreground">{stageLabel(stage, i18n.language)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{reason}</span>
        {waiting > 0 && (
          <button
            type="button"
            onClick={onOpenInbox}
            className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-2xs font-medium', statusTone('awaitingDecision'))}
          >
            {t('build.stageWaiting', { count: waiting })}
          </button>
        )}
        {stage.global && canRun && (
          <Button
            size="xs"
            variant="outline"
            disabled={idle || busy}
            className="shrink-0 [&_svg]:size-2.5"
            onClick={() => void runStore.startUnit({ workspaceId, skillId: stage.skillId, unitPath: '' })}
          >
            <Play />
            {t('build.runGlobal')}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Every document at once, one segment each.
 *
 * The corpus is the thing being digested, and a count says how far along that
 * is without ever showing its shape. This does, in one line, and it is the
 * only place a running batch can be watched moving rather than reported on.
 */
function CoverageRibbon({ cards, busy, selectedKey, onSelect }: {
  cards: readonly CoverageCard[]
  busy: boolean
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const { t } = useTranslation()
  const ordered = useMemo(
    () => [...cards].sort((a, b) => GROUPS.indexOf(a.state) - GROUPS.indexOf(b.state)),
    [cards],
  )

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-sidebar px-4 py-2.5">
      <div className="flex min-w-0 flex-1 gap-px">
        {ordered.map(card => (
          <button
            key={keyOf(card)}
            type="button"
            title={card.name}
            aria-label={card.name}
            onClick={() => onSelect(keyOf(card))}
            className={cn(
              'h-3.5 min-w-0 flex-1 rounded-xs transition-opacity duration-150 hover:opacity-70',
              statusDot(card.state),
              card.state === 'running' && 'animate-pulse',
              keyOf(card) === selectedKey && 'ring-1 ring-foreground',
            )}
          />
        ))}
      </div>
      <span className="shrink-0 text-2xs text-muted-foreground">
        {busy ? t('build.busy') : t('build.documents', { count: cards.length })}
      </span>
    </div>
  )
}

/**
 * One state, and the documents in it.
 *
 * The heading carries the state's colour so the rows do not have to, and it
 * is where a bulk action belongs, because covering a group is one batch rather
 * than a row of buttons pressed in turn. Settled documents start folded, since
 * a reader opens this to find what is still asking for something.
 */
function Group({ workspaceId, state, cards, stage, selectedKey, onSelect, onRunAll }: {
  workspaceId: string
  state: CoverageState
  cards: readonly CoverageCard[]
  stage: CoverageStage | undefined
  selectedKey: string | null
  onSelect: (key: string) => void
  onRunAll?: (() => void) | undefined
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(state !== 'covered')

  return (
    <section>
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/60 bg-card/80 px-4 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className={cn('size-2 shrink-0 rounded-full', statusDot(state))} />
          <h2 className="truncate text-2xs font-semibold uppercase tracking-wider text-foreground">
            {t(`build.state.${state}`)}
          </h2>
          <span className="font-mono text-2xs text-muted-foreground">{cards.length}</span>
        </button>
        {onRunAll && (
          <Button size="xs" variant="outline" className="ml-auto [&_svg]:size-2.5" onClick={onRunAll}>
            <Play />
            {t(state === 'uncovered' ? 'build.runGroup' : 'build.rerunGroup', { skill: stageLabel(stage, i18n.language) })}
          </Button>
        )}
      </header>
      {open && (
        <ul>
          {cards.map(card => (
            <Row
              key={keyOf(card)}
              workspaceId={workspaceId}
              card={card}
              active={keyOf(card) === selectedKey}
              onClick={() => onSelect(keyOf(card))}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * What the run on this row is doing, while it is doing it.
 *
 * A spinner says only that something is happening. The stream has carried the
 * work the whole time, so the row says which file is being read and how much
 * has come back, and a reader can tell a run that is working from one that is
 * stuck without opening it.
 *
 * Only ever one of these on screen, since one build runs at a time.
 */
function LiveLine({ workspaceId, runId }: { workspaceId: string, runId: string }) {
  const { t } = useTranslation()
  const run = useRun(workspaceId, runId)

  useEffect(() => {
    runStore.loadRun(workspaceId, runId, 'build')
  }, [workspaceId, runId])

  const activity = summariseActivity(run?.events ?? [])
  const reads = activity.toolCalls + activity.graphQueries

  return (
    <span className="flex items-baseline gap-2">
      <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
        {activity.narration ?? t('build.starting')}
      </span>
      {(reads > 0 || activity.blocks > 0) && (
        <span className="shrink-0 font-mono text-2xs text-muted-foreground/70">
          {t('build.liveCounts', { reads, blocks: activity.blocks })}
        </span>
      )}
    </span>
  )
}

/**
 * One document, at the width of the surface.
 *
 * A row states what is true of it and nothing else. What to do about it lives
 * on the group heading, where it is one batch, or in the detail pane, where
 * there is room to say what it would mean.
 *
 * One line, until a run is reading it. The counts sit right so the eye can
 * run down them, and the two that nearly every document has are given fixed
 * widths so that column holds still while the rest varies.
 */
function Row({ workspaceId, card, active, onClick }: {
  workspaceId: string
  card: CoverageCard
  active: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const { formatRelativeTime } = useLocaleFormat()

  return (
    <ListRow active={active} onClick={onClick} className="flex-col gap-1">
      <span className="flex w-full items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-xs leading-snug text-foreground">{card.name}</span>
        <span className="flex shrink-0 items-center gap-3 font-mono text-2xs text-muted-foreground">
          <span className="w-24 truncate text-right text-muted-foreground/70">{card.sourceId}</span>
          {card.driftIssueIds.length > 0 && <span>{t('build.drifts', { count: card.driftIssueIds.length })}</span>}
          {card.proposalIds.length > 0 && <span>{t('build.proposals', { count: card.proposalIds.length })}</span>}
          {card.clarificationIds.length > 0 && <span>{t('build.questions', { count: card.clarificationIds.length })}</span>}
          <span className="w-16 text-right">
            {card.nodeIds.length > 0 ? t('build.nodes', { count: card.nodeIds.length }) : ''}
          </span>
          <span className="w-14 text-right">
            {card.lastRun ? formatRelativeTime(card.lastRun.startedAt) : ''}
          </span>
        </span>
      </span>
      {card.state === 'running' && card.lastRun && (
        <LiveLine workspaceId={workspaceId} runId={card.lastRun.runId} />
      )}
    </ListRow>
  )
}

/**
 * One document's standing, and the reasoning that produced it.
 *
 * Deciding happens in the Inbox, so what waits here is named and linked rather
 * than reviewed twice. What this pane adds is the run's own blocks, which is
 * the only place the working behind a card can be read.
 */
/**
 * One document's standing, and the record of how it got there.
 *
 * Facts and links rather than a second review pane. Deciding on a change is
 * the Inbox's act and it has the room for it, so what waits here is named and
 * pointed at. What this pane adds is the document's own slice of the graph and
 * the run that last read it, which are the two things with no other home.
 */
function CardDetail({ workspaceId, card, stage, stages, canRun, onClose }: {
  workspaceId: string
  card: CoverageCard
  stage: CoverageStage | undefined
  stages: readonly CoverageStage[]
  canRun: boolean
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.language
  const { formatRelativeTime } = useLocaleFormat()
  const navigation = useTabNavigation()
  const graph = useGraphNavigation()
  const [view, setView] = useState<'facts' | 'reasoning' | typeof TRANSCRIPT_VIEW>('facts')
  const run = useRun(workspaceId, card.lastRun?.runId ?? null)
  const events = run?.events ?? []
  // Worth a line only where the ontology has more than one per-document step.
  // With one, it says the same thing on every card, which is nothing.
  const showStage = stages.filter(item => !item.global).length > 1
  const waiting = card.proposalIds.length + card.clarificationIds.length

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-card/40">
      <DetailPanel
        title={card.name}
        onClose={onClose}
        badges={<StatusBadge status={card.state} label={t(`build.state.${card.state}`)} />}
        subtitle={<SourceLink workspaceId={workspaceId} card={card} />}
        {...(stage && canRun
          ? {
              actions: (
                <Button
                  size="sm"
                  className="[&_svg]:size-3"
                  onClick={() => void runStore.startUnit({ workspaceId, skillId: stage.skillId, unitPath: card.path })}
                >
                  <Play />
                  {t(card.state === 'uncovered' ? 'build.runUnit' : 'build.rerunUnit', { skill: stageLabel(stage, language) })}
                </Button>
              ),
            }
          : {})}
        views={(
          <Tabs value={view} onValueChange={next => setView(next as typeof view)}>
            <TabsList variant="line">
              <TabsTrigger value="facts">{t('build.view.facts')}</TabsTrigger>
              <TabsTrigger value="reasoning">{t('build.view.reasoning')}</TabsTrigger>
              <TabsTrigger value={TRANSCRIPT_VIEW} className="gap-1.5">
                {t('ask.view.transcript')}
                {events.length > 0 && <span className="font-mono text-muted-foreground/60">{events.length}</span>}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      >
        {view === TRANSCRIPT_VIEW
          ? (
              <RunTranscript workspaceId={workspaceId} runId={card.lastRun?.runId} />
            )
          : view === 'reasoning'
            ? (
                <RunBlocks
                  workspaceId={workspaceId}
                  runId={card.lastRun?.runId}
                  {...(card.nodeIds.length === 0
                    ? { heading: t('build.lastReading'), note: t('build.lastReadingNote') }
                    : {})}
                />
              )
            : (
                <>
                  {waiting > 0 && (
                    <section>
                      <SectionTitle>{t('build.waiting')}</SectionTitle>
                      <div className="mt-1 flex flex-col gap-0.5">
                        {card.proposalIds.map(proposalId => (
                          <button
                            key={proposalId}
                            type="button"
                            onClick={() => navigation?.focusProposal(proposalId as ProposalId)}
                            className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                          >
                            <ClipboardCheck className="size-3 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate text-2xs text-foreground">{t('build.reviewChange')}</span>
                            <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                          </button>
                        ))}
                        {card.clarificationIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => navigation?.openInbox()}
                            className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                          >
                            <MessageCircleQuestion className="size-3 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate text-2xs text-foreground">
                              {t('build.answerQuestions', { count: card.clarificationIds.length })}
                            </span>
                            <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </section>
                  )}

                  <section>
                    <SectionTitle>{t('build.inModel')}</SectionTitle>
                    <div className="mt-1 flex flex-col gap-1.5">
                      <DetailFact label={t('build.fact.nodes')} value={String(card.nodeIds.length)} />
                      {card.incorporatedSha && (
                        <DetailFact label={t('build.fact.incorporated')} value={card.incorporatedSha.slice(0, 12)} />
                      )}
                      {card.driftIssueIds.length > 0 && (
                        <p className="pt-0.5 text-2xs text-orange-600 dark:text-orange-400">
                          {t('build.conflictsHint', { count: card.driftIssueIds.length })}
                        </p>
                      )}
                    </div>
                    {card.nodeIds.length > 0 && (
                      // Opened on the graph surface rather than drawn here. A
                      // slice this size is unreadable in a side panel, and a
                      // node clicked inside one has nowhere to put its detail.
                      <button
                        type="button"
                        onClick={() => graph?.focusNodes(card.nodeIds, card.name)}
                        className="mt-2 flex min-h-8 w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left transition-colors hover:bg-accent"
                      >
                        <Network className="size-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-2xs text-foreground">
                          {t('build.openInGraph', { count: card.nodeIds.length })}
                        </span>
                        <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                      </button>
                    )}
                  </section>

                  <section>
                    <SectionTitle>{t('build.lastRead')}</SectionTitle>
                    <div className="mt-1 flex flex-col gap-1.5">
                      {card.lastRun
                        ? (
                            <DetailFact
                              label={t('build.fact.when')}
                              value={t(card.lastRun.exitCode === 0 || card.lastRun.exitCode === undefined ? 'build.fact.ranAt' : 'build.fact.failedAt', {
                                step: stageLabel(stages.find(item => item.skillId === card.lastRun!.skillId), language),
                                when: formatRelativeTime(card.lastRun.startedAt),
                              })}
                            />
                          )
                        : <p className="text-2xs text-muted-foreground">{t('build.neverRead')}</p>}
                      {card.sha && <DetailFact label={t('build.fact.observed')} value={card.sha.slice(0, 12)} />}
                      {showStage && card.stage && (
                        <DetailFact label={t('build.fact.stage')} value={stageLabel(stages.find(item => item.skillId === card.stage), language)} />
                      )}
                    </div>
                  </section>
                </>
              )}
      </DetailPanel>
    </aside>
  )
}

/**
 * The document itself, wherever it actually lives.
 *
 * The loader knows its own host, so this asks rather than assembling a URL,
 * and a source with no host simply reads as a path.
 */
function SourceLink({ workspaceId, card }: { workspaceId: string, card: CoverageCard }) {
  const { data } = useQuery({
    queryKey: ['source-ref-url', workspaceId, card.sourceId, card.path],
    queryFn: () => api.resolveSourceRefUrl(workspaceId, card.sourceId, { uri: card.path }),
    staleTime: 5 * 60 * 1000,
  })
  const label = `${card.sourceId} / ${card.path}`
  if (!data?.url)
    return <>{label}</>
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-baseline gap-1 hover:text-foreground hover:underline"
    >
      {label}
      <ExternalLink className="size-2.5 shrink-0 translate-y-0.5" />
    </a>
  )
}
