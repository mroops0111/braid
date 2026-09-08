import type { CoverageBoard, CoverageCard, CoverageStage, CoverageState, ProposalId } from '@braidhq/schema'
import { AlertTriangle, CircleDashed, CircleSlash, FileText, Loader2, MessageCircleQuestion, RefreshCw, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RunBlocks } from '@/components/blocks/RunBlocks'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCoverage, useSkills } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
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
        <StageStrip board={board!} workspaceId={workspaceId} canRun={mayRun} />
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin">
          <div className="flex h-full min-w-max gap-3 p-4">
            {columns.map(column => (
              <Column
                key={column.state}
                state={column.state}
                cards={column.cards}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                onRunAll={unitStage && mayRunUnits && ACTIONABLE.has(column.state)
                  ? () => { for (const card of column.cards) void runStore.startUnit({ workspaceId, skillId: unitStage.skillId, unitPath: card.path }) }
                  : undefined}
              />
            ))}
          </div>
        </div>
      </div>
      {selected && (
        <CardDetail
          key={keyOf(selected)}
          workspaceId={workspaceId}
          card={selected}
          stage={unitStage}
          canRun={mayRunUnits}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  )
}

const STATE_ICON = {
  uncovered: CircleDashed,
  running: Loader2,
  awaitingDecision: MessageCircleQuestion,
  failed: CircleSlash,
  sourceChanged: RefreshCw,
  conflicted: AlertTriangle,
  covered: ShieldCheck,
} as const

// Semantic, not decorative. Attention states carry weight, settled ones do not.
const STATE_TONE: Record<CoverageState, string> = {
  uncovered: 'text-muted-foreground',
  running: 'text-blue-600 dark:text-blue-400',
  awaitingDecision: 'text-amber-600 dark:text-amber-400',
  failed: 'text-red-600 dark:text-red-400',
  sourceChanged: 'text-violet-600 dark:text-violet-400',
  conflicted: 'text-orange-600 dark:text-orange-400',
  covered: 'text-emerald-600 dark:text-emerald-400',
}

const STATE_EDGE: Record<CoverageState, string> = {
  uncovered: 'border-l-border',
  running: 'border-l-blue-500',
  awaitingDecision: 'border-l-amber-500',
  failed: 'border-l-red-500',
  sourceChanged: 'border-l-violet-500',
  conflicted: 'border-l-orange-500',
  covered: 'border-l-emerald-500',
}

function keyOf(card: CoverageCard): string {
  return `${card.sourceId} ${card.path}`
}

/**
 * The ontology's pipeline, and the steps that act on the graph as a whole.
 *
 * Narrow on purpose. It says which steps exist and how far along the work is,
 * which is worth a strip, and it is not a canvas because nobody edits it.
 */
function StageStrip({ board, workspaceId, canRun }: {
  board: CoverageBoard
  workspaceId: string
  canRun: (skillId: string) => boolean
}) {
  const { t } = useTranslation()
  const settled = board.cards.filter(card => card.state === 'covered').length

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-sm text-foreground">{settled}</span>
        <span className="text-2xs text-muted-foreground">
          {t('build.coveredOf', { total: board.cards.length })}
        </span>
      </div>
      <ol className="flex flex-wrap items-center gap-1.5">
        {board.stages.map(stage => (
          <li key={stage.skillId} className="flex items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-2xs">{stage.skillId}</Badge>
            {stage.global && canRun(stage.skillId) && (
              <Button
                size="xs"
                variant="ghost"
                className="[&_svg]:size-2.5"
                onClick={() => void runStore.startUnit({ workspaceId, skillId: stage.skillId, unitPath: '' })}
              >
                {t('build.runGlobal')}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </header>
  )
}

function Column({ state, cards, selectedKey, onSelect, onRunAll }: {
  state: CoverageState
  cards: readonly CoverageCard[]
  selectedKey: string | null
  onSelect: (key: string) => void
  onRunAll?: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const Icon = STATE_ICON[state]
  // A settled column is the count, not the contents. Sixty cards nobody needs
  // to read would push every column that does need reading off the screen.
  const [open, setOpen] = useState(state !== 'covered')

  return (
    <section className={cn('flex h-full shrink-0 flex-col', cards.length === 0 ? 'w-40' : 'w-64')}>
      <header className="flex shrink-0 items-center gap-1.5 px-1 pb-2">
        <Icon className={cn('size-3', STATE_TONE[state], state === 'running' && 'animate-spin')} />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-xs font-medium text-foreground transition-colors hover:text-muted-foreground"
        >
          {t(`build.state.${state}`)}
        </button>
        <span className="font-mono text-2xs text-muted-foreground">{cards.length}</span>
        {onRunAll && cards.length > 0 && (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={onRunAll}>
            {t('build.runColumn')}
          </Button>
        )}
      </header>
      {open && (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto scrollbar-thin pr-0.5">
          {cards.map(card => (
            <UnitCard
              key={keyOf(card)}
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

function UnitCard({ card, active, onClick }: { card: CoverageCard, active: boolean, onClick: () => void }) {
  const { t } = useTranslation()
  const waiting = card.proposalIds.length + card.clarificationIds.length

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full flex-col gap-1 rounded-md border border-l-2 border-border bg-card px-2.5 py-2 text-left transition-colors duration-150 hover:border-border/60',
          STATE_EDGE[card.state],
          active && 'bg-accent',
        )}
      >
        <span className="line-clamp-2 text-xs leading-snug text-foreground">{card.name}</span>
        <span className="flex items-center gap-2 font-mono text-2xs text-muted-foreground">
          <span className="truncate">{card.sourceId}</span>
          {card.nodeCount > 0 && <span>{t('build.nodes', { count: card.nodeCount })}</span>}
        </span>
        {(waiting > 0 || card.driftIssueIds.length > 0) && (
          <span className="flex flex-wrap gap-1">
            {card.proposalIds.length > 0 && (
              <Badge variant="outline" className="text-2xs">{t('build.proposals', { count: card.proposalIds.length })}</Badge>
            )}
            {card.clarificationIds.length > 0 && (
              <Badge variant="outline" className="text-2xs">{t('build.questions', { count: card.clarificationIds.length })}</Badge>
            )}
            {card.driftIssueIds.length > 0 && (
              <Badge variant="outline" className="text-2xs">{t('build.drifts', { count: card.driftIssueIds.length })}</Badge>
            )}
          </span>
        )}
      </button>
    </li>
  )
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
      <header className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-medium leading-snug text-foreground">{card.name}</h2>
          <Button size="xs" variant="ghost" onClick={onClose}>{t('common.close')}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('text-2xs', STATE_TONE[card.state])}>
            {t(`build.state.${card.state}`)}
          </Badge>
          <span className="font-mono text-2xs text-muted-foreground">{card.sourceId}</span>
        </div>
        <p className="break-all font-mono text-2xs text-muted-foreground">{card.path}</p>
        {stage && canRun && (
          <Button
            size="sm"
            className="self-start"
            onClick={() => void runStore.startUnit({ workspaceId, skillId: stage.skillId, unitPath: card.path })}
          >
            {t('build.runUnit', { skill: stage.skillId })}
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <section className="flex flex-col gap-1.5 border-b border-border px-4 py-3 text-2xs">
          <Fact label={t('build.fact.nodes')} value={String(card.nodeCount)} />
          {card.incorporatedSha && <Fact label={t('build.fact.incorporated')} value={card.incorporatedSha.slice(0, 12)} />}
          {card.sha && card.sha !== card.incorporatedSha && <Fact label={t('build.fact.onDisk')} value={card.sha.slice(0, 12)} />}
          {card.stage && <Fact label={t('build.fact.stage')} value={card.stage} />}
          {card.lastRun && <Fact label={t('build.fact.lastRun')} value={card.lastRun.skillId} />}
        </section>

        {(card.proposalIds.length > 0 || card.clarificationIds.length > 0) && (
          <section className="flex flex-col gap-1 border-b border-border px-4 py-3">
            <h3 className="mb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('build.waiting')}
            </h3>
            {card.proposalIds.map(proposalId => (
              <button
                key={proposalId}
                type="button"
                onClick={() => navigation?.focusProposal(proposalId as ProposalId)}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-accent"
              >
                <span className="flex-1 truncate font-mono text-2xs text-foreground">{proposalId}</span>
                <span className="text-2xs text-muted-foreground">{t('build.decide')}</span>
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
            <h3 className="mb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
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
