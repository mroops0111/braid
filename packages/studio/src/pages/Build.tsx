import type { CoverageBoard, CoverageCard, CoverageStage, CoverageState, ProposalId } from '@braidhq/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CircleDashed, CircleSlash, FileText, Loader2, MessageCircleQuestion, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RunBlocks } from '@/components/blocks/RunBlocks'
import { EmptyState } from '@/components/EmptyState'
import { statusTone } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { summariseActivity } from '@/lib/blocks/runActivity'
import { useBatchStatus, useCoverage, useSkills } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useRun } from '@/lib/useRun'
import { useTabNavigation } from '@/lib/useTabNavigation'
import { cn } from '@/lib/utils'
import { useWorkspacePolicy } from '@/policy'

/**
 * Left to right, the way a document travels: not read, being read, waiting on
 * a person, broken, out of date, disputed, settled.
 */
const COLUMNS: readonly CoverageState[] = [
  'uncovered',
  'running',
  'awaitingDecision',
  'failed',
  'sourceChanged',
  'conflicted',
  'covered',
]

/** Where running the per-unit step is the answer, so the column offers it. */
const ACTIONABLE: ReadonlySet<CoverageState> = new Set<CoverageState>(['uncovered', 'sourceChanged', 'failed'])

const STATE_ICON = {
  uncovered: CircleDashed,
  running: Loader2,
  awaitingDecision: MessageCircleQuestion,
  failed: CircleSlash,
  sourceChanged: RefreshCw,
  conflicted: AlertTriangle,
  covered: ShieldCheck,
} as const

/**
 * Every source document, and what the model has made of it.
 *
 * The card is the document, not the run, because the question a reader opens
 * this with is what the model still does not know rather than what has
 * executed. A document read three times and failed twice is one card.
 *
 * The columns are mechanical and hold for any ontology. The steps across the
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

  const columns = useMemo(() => COLUMNS.map(state => ({
    state,
    cards: cards.filter(card => card.state === state),
  })), [cards])

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
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <StageStrip
          board={board!}
          workspaceId={workspaceId}
          canRun={skillId => mayRun(skillId) && !busy}
          busy={busy}
          onOpenInbox={() => navigation?.openInbox()}
        />
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin">
          <div className="flex h-full min-w-max gap-2 p-3">
            {columns.map(column => (
              <Column
                key={column.state}
                workspaceId={workspaceId}
                state={column.state}
                cards={column.cards}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                onRunAll={unitStage && mayRunUnits && !busy && ACTIONABLE.has(column.state)
                  ? () => setCovering(column.cards)
                  : undefined}
              />
            ))}
          </div>
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
          canRun={mayRunUnits && !busy}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  )
}

/**
 * Covering a column, which is a batch.
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

function keyOf(card: CoverageCard): string {
  return `${card.sourceId} ${card.path}`
}

/**
 * How far along the workspace is, and the steps that act on the graph as a
 * whole. Narrow on purpose: it says which steps exist, which is worth a strip,
 * and it is not a canvas because nobody edits the pipeline.
 */
function StageStrip({ board, workspaceId, canRun, busy, onOpenInbox }: {
  board: CoverageBoard
  workspaceId: string
  canRun: (skillId: string) => boolean
  busy: boolean
  onOpenInbox: () => void
}) {
  const { t } = useTranslation()
  const settled = board.cards.filter(card => card.state === 'covered').length

  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-border px-4">
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-sm text-foreground">{settled}</span>
        <span className="text-2xs text-muted-foreground">
          {t('build.coveredOf', { total: board.cards.length })}
        </span>
      </div>
      <ol className="flex items-center gap-1">
        {board.stages.map((stage, index) => {
          // A graph-wide step belongs to no document, so what it left waiting
          // is said here or nowhere.
          const waiting = stage.proposalIds.length + stage.clarificationIds.length
          return (
            <li key={stage.skillId} className="flex items-center gap-1">
              {index > 0 && <span className="pr-1 text-muted-foreground">→</span>}
              <Badge variant="outline" className="font-mono text-2xs">{stage.skillId}</Badge>
              {waiting > 0 && (
                <button
                  type="button"
                  onClick={onOpenInbox}
                  className={cn('rounded-md border px-1.5 py-0.5 text-2xs font-medium', statusTone('awaitingDecision'))}
                >
                  {t('build.stageWaiting', { count: waiting })}
                </button>
              )}
              {stage.global && canRun(stage.skillId) && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => void runStore.startUnit({ workspaceId, skillId: stage.skillId, unitPath: '' })}
                >
                  {t('build.runGlobal')}
                </Button>
              )}
            </li>
          )
        })}
      </ol>
      {busy && (
        <span className="ml-auto flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Loader2 className="size-2.5 animate-spin" />
          {t('build.busy')}
        </span>
      )}
    </header>
  )
}

/**
 * One state, and the documents in it.
 *
 * The lane carries the state's colour so the cards do not have to. A card
 * repeating what its own column already says is noise, and seven tinted
 * borders across a board read as decoration rather than as meaning.
 */
function Column({ workspaceId, state, cards, selectedKey, onSelect, onRunAll }: {
  workspaceId: string
  state: CoverageState
  cards: readonly CoverageCard[]
  selectedKey: string | null
  onSelect: (key: string) => void
  onRunAll?: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const Icon = STATE_ICON[state]

  return (
    <section className="flex h-full w-64 shrink-0 flex-col rounded-lg bg-muted/60">
      <header className="flex shrink-0 items-center gap-1.5 px-2.5 py-2">
        <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', statusTone(state))}>
          <Icon className={cn('size-2.5', state === 'running' && 'animate-spin')} />
        </span>
        <h2 className="truncate text-2xs font-semibold uppercase tracking-wider text-foreground">
          {t(`build.state.${state}`)}
        </h2>
        <span className="font-mono text-2xs text-muted-foreground">{cards.length}</span>
        {onRunAll && cards.length > 0 && (
          <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground" onClick={onRunAll}>
            {t('build.runColumn')}
          </Button>
        )}
      </header>
      {cards.length === 0
        ? <p className="px-2.5 pb-2 text-2xs text-muted-foreground/70">{t('build.columnEmpty')}</p>
        : (
            <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto scrollbar-thin px-1.5 pb-1.5">
              {cards.map(card => (
                <UnitCard
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
 * What the run on this card is doing, while it is doing it.
 *
 * A spinner says only that something is happening. The stream has carried the
 * work the whole time, so the card says which file is being read and how much
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
  const reads = activity.sourceReads + activity.graphQueries

  return (
    <span className="flex flex-col gap-0.5 border-t border-border pt-1">
      <span className="line-clamp-2 text-2xs leading-snug text-muted-foreground">
        {activity.narration ?? t('build.starting')}
      </span>
      {(reads > 0 || activity.blocks > 0) && (
        <span className="font-mono text-2xs text-muted-foreground/70">
          {t('build.liveCounts', { reads, blocks: activity.blocks })}
        </span>
      )}
    </span>
  )
}

function UnitCard({ workspaceId, card, active, onClick }: { workspaceId: string, card: CoverageCard, active: boolean, onClick: () => void }) {
  const { t } = useTranslation()

  return (
    <li className="relative">
      {active && <span className="absolute inset-y-1.5 left-0 z-10 w-[3px] rounded-r-full bg-primary" />}
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full flex-col gap-1 rounded-md border border-border px-2.5 py-2 text-left transition-colors duration-150',
          active ? 'bg-accent' : 'bg-card hover:bg-accent/50',
        )}
      >
        <span className="line-clamp-2 text-xs leading-snug text-foreground">{card.name}</span>
        <span className="flex items-center gap-2 font-mono text-2xs text-muted-foreground">
          <span className="truncate">{card.sourceId}</span>
          {card.nodeCount > 0 && <span className="shrink-0">{t('build.nodes', { count: card.nodeCount })}</span>}
        </span>
        {card.state === 'running' && card.lastRun && (
          <LiveLine workspaceId={workspaceId} runId={card.lastRun.runId} />
        )}
        {(card.proposalIds.length > 0 || card.clarificationIds.length > 0 || card.driftIssueIds.length > 0) && (
          <span className="flex flex-wrap gap-1 pt-0.5">
            {card.proposalIds.length > 0 && <Chip>{t('build.proposals', { count: card.proposalIds.length })}</Chip>}
            {card.clarificationIds.length > 0 && <Chip>{t('build.questions', { count: card.clarificationIds.length })}</Chip>}
            {card.driftIssueIds.length > 0 && <Chip>{t('build.drifts', { count: card.driftIssueIds.length })}</Chip>}
          </span>
        )}
      </button>
    </li>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">{children}</span>
}

/**
 * One document's standing, and the reasoning that produced it.
 *
 * Deciding happens in the Inbox, so what waits here is named and linked rather
 * than reviewed twice. What this pane adds is the run's own blocks, which is
 * the only place the working behind a card can be read.
 */
function CardDetail({ workspaceId, card, stage, canRun, onClose }: {
  workspaceId: string
  card: CoverageCard
  stage: CoverageStage | undefined
  canRun: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigation = useTabNavigation()

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <span className={cn('rounded-md border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide', statusTone(card.state))}>
          {t(`build.state.${card.state}`)}
        </span>
        <Button size="xs" variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium leading-snug text-foreground">{card.name}</h2>
          <p className="break-all font-mono text-2xs text-muted-foreground">
            {card.sourceId}
            {' / '}
            {card.path}
          </p>
          {stage && canRun && (
            <Button
              size="sm"
              className="mt-1 self-start"
              onClick={() => void runStore.startUnit({ workspaceId, skillId: stage.skillId, unitPath: card.path })}
            >
              {t('build.runUnit', { skill: stage.skillId })}
            </Button>
          )}
        </section>

        <section className="flex flex-col gap-1.5 border-b border-border px-4 py-3 text-2xs">
          <Fact label={t('build.fact.nodes')} value={String(card.nodeCount)} />
          {card.incorporatedSha && <Fact label={t('build.fact.incorporated')} value={card.incorporatedSha.slice(0, 12)} />}
          {card.sha && card.sha !== card.incorporatedSha && <Fact label={t('build.fact.onDisk')} value={card.sha.slice(0, 12)} />}
          {card.stage && <Fact label={t('build.fact.stage')} value={card.stage} />}
          {card.lastRun && <Fact label={t('build.fact.lastRun')} value={card.lastRun.skillId} />}
        </section>

        {(card.proposalIds.length > 0 || card.clarificationIds.length > 0) && (
          <section className="flex flex-col gap-0.5 border-b border-border px-4 py-3">
            <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('build.waiting')}
            </h3>
            {card.proposalIds.map(proposalId => (
              <button
                key={proposalId}
                type="button"
                onClick={() => navigation?.focusProposal(proposalId as ProposalId)}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent"
              >
                <span className="flex-1 truncate font-mono text-2xs text-foreground">{proposalId}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">{t('build.decide')}</span>
              </button>
            ))}
            {card.clarificationIds.map(clarificationId => (
              <span key={clarificationId} className="px-1.5 py-1 font-mono text-2xs text-muted-foreground">
                {clarificationId}
              </span>
            ))}
          </section>
        )}

        {card.driftIssueIds.length > 0 && (
          <section className="border-b border-border px-4 py-3">
            <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('build.conflicts')}
            </h3>
            <p className="text-2xs text-muted-foreground">{t('build.conflictsHint', { count: card.driftIssueIds.length })}</p>
          </section>
        )}

        <RunBlocks workspaceId={workspaceId} runId={card.lastRun?.runId} />
      </div>
    </aside>
  )
}

function Fact({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-foreground">{value}</span>
    </div>
  )
}
