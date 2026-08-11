import type { BatchPlan, BatchStatus, BatchUnit, BatchUnitStatus, SkillInputOptionsResponse, SkillRunId } from '@braidhq/schema'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, CheckCircle2, CircleDot, ClipboardCheck, FastForward, FileText, HelpCircle, Loader2, Play, PlayCircle, Search, Sparkles, StopCircle, Terminal, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkillTranscript } from '@/components/SkillTranscript'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useLocaleFormat } from '@/lib/i18n'
import { queryKeys, useBatchStatus } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useRun } from '@/lib/useRun'
import { cn } from '@/lib/utils'

interface BatchPageProps {
  workspaceId: string
}

const STATUS_TONE: Record<BatchStatus, string> = {
  idle: 'border-zinc-400/40 bg-zinc-400/10 text-zinc-700 dark:text-zinc-300',
  deriving: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  running: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  completed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  stopped: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  archived: 'border-zinc-400/40 bg-zinc-400/10 text-zinc-700 dark:text-zinc-300',
}

const UNIT_ICON: Record<BatchUnitStatus, ReactNode> = {
  pending: <CircleDot className="size-4 text-muted-foreground" />,
  running: <Loader2 className="size-4 animate-spin text-sky-500" />,
  completed: <CheckCircle2 className="size-4 text-emerald-500" />,
  failed: <XCircle className="size-4 text-rose-500" />,
  skipped: <FastForward className="size-4 text-amber-500" />,
}

export function BatchPage({ workspaceId }: BatchPageProps) {
  const { t } = useTranslation()
  const { data: plan, isLoading } = useBatchStatus(workspaceId)

  if (isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>

  if (!plan || plan.status === 'idle' || plan.status === 'archived')
    return <PreStart workspaceId={workspaceId} previousPlan={plan ?? null} />

  return <ActiveBatch workspaceId={workspaceId} plan={plan} />
}

function PreStart({ workspaceId, previousPlan }: { workspaceId: string, previousPlan: BatchPlan | null }) {
  const { t } = useTranslation()
  const { formatDateTime } = useLocaleFormat()
  const queryClient = useQueryClient()

  const start = useMutation({
    mutationFn: () => api.startBatch(workspaceId, true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.batch(workspaceId) })
    },
  })

  const preview = useQuery({
    queryKey: ['batch-preview', workspaceId],
    queryFn: () => api.listSkillInputOptions(workspaceId, 'source'),
  })

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto p-8 scrollbar-thin">
      <header className="flex items-center gap-3">
        <Sparkles className="size-6 text-primary" />
        <h1 className="text-xl font-semibold">{t('review.batch.bootstrapTitle')}</h1>
      </header>
      <p className="text-sm leading-relaxed text-muted-foreground [text-wrap:pretty]">
        {t('review.batch.bootstrapDescription')}
      </p>

      <section className="rounded-lg border border-border bg-card/40 p-4 text-sm leading-relaxed text-foreground/90 [text-wrap:pretty]">
        <div className="font-medium">{t('review.batch.whatHappens')}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('review.batch.whatHappensDescription')}
        </p>
      </section>

      <BatchPreviewList query={preview} />

      {previousPlan && (
        <section className="rounded-lg border border-border bg-card/40 p-4 text-xs text-muted-foreground">
          {t('review.batch.previousBatchPrefix')}
          {' '}
          <span className={cn('rounded border px-1.5 py-0.5 font-medium uppercase tracking-wider', STATUS_TONE[previousPlan.status])}>{previousPlan.status}</span>
          {' '}
          {t('review.batch.previousBatchMiddle', { count: previousPlan.units.length, date: formatDateTime(previousPlan.createdAt) })}
        </section>
      )}

      {start.isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {start.error instanceof Error ? start.error.message : t('review.batch.failedToStart')}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          size="lg"
          variant="default"
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          <PlayCircle className="size-4" />
          {start.isPending ? t('review.batch.starting') : t('review.batch.startBootstrapButton')}
        </Button>
      </div>
    </div>
  )
}

function BatchPreviewList({ query }: { query: ReturnType<typeof useQuery<SkillInputOptionsResponse, Error>> }) {
  const { t } = useTranslation()
  if (query.isLoading) {
    return (
      <section className="rounded-lg border border-border bg-card/40 p-4 text-xs text-muted-foreground">
        {t('review.batch.loadingUnits')}
      </section>
    )
  }
  if (query.error) {
    return (
      <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-xs text-destructive">
        {query.error.message}
      </section>
    )
  }
  const items = query.data?.items ?? []

  if (items.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card/40 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Search className="size-4 text-muted-foreground" />
          {t('review.batch.willDeriveUnits')}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('review.batch.willDeriveUnitsDescription')}
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-foreground">
          {t('review.batch.unitsWillBeProcessed', { count: items.length })}
        </div>
        <span className="text-2xs text-muted-foreground">{t('review.batch.oneJobPerRow')}</span>
      </div>
      <ul className="mt-3 space-y-1">
        {items.map(item => (
          <li key={item.value} className="flex items-start gap-2 text-xs">
            <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-foreground/90">{item.label}</div>
              {item.description && (
                <div className="truncate text-2xs text-muted-foreground">{item.description}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ActiveBatch({ workspaceId, plan }: { workspaceId: string, plan: BatchPlan }) {
  const terminal = isTerminal(plan.status)
  const activeRunId = plan.running?.skillRunId ?? null
  // Default the inspector to the active unit (live) or the most recent completed one.
  const initialRunId = activeRunId ?? lastFinishedRunId(plan.units)
  const [selectedRunId, setSelectedRunId] = useTrackedRunId(initialRunId, activeRunId)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <BatchHeader workspaceId={workspaceId} plan={plan} terminal={terminal} />
      {terminal && <ReportBar plan={plan} />}
      <div className="flex flex-1 overflow-hidden">
        <UnitList
          plan={plan}
          selectedRunId={selectedRunId}
          activeRunId={activeRunId}
          onSelect={setSelectedRunId}
        />
        <LogPane workspaceId={workspaceId} plan={plan} selectedRunId={selectedRunId} />
      </div>
    </div>
  )
}

function BatchHeader({ workspaceId, plan, terminal }: {
  workspaceId: string
  plan: BatchPlan
  terminal: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // Every header action mutates the plan server-side,
  // so they all need to refetch the same query.
  // Sharing the callback keeps each mutation declaration,
  // to a single responsibility, its mutationFn.
  const refreshBatch = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.batch(workspaceId) })
  }
  const stop = useMutation({ mutationFn: () => api.stopBatch(workspaceId), onSuccess: refreshBatch })
  const resume = useMutation({ mutationFn: () => api.resumeBatch(workspaceId), onSuccess: refreshBatch })
  const archive = useMutation({ mutationFn: () => api.archiveBatch(workspaceId), onSuccess: refreshBatch })

  const completed = plan.units.filter(u => u.status === 'completed').length
  const hasUnfinished = plan.units.some(u => u.status === 'failed' || u.status === 'pending')
  const latestCheckpointPhase = plan.checkpointPhases[plan.checkpointPhases.length - 1]
  const checkpointRunning = latestCheckpointPhase?.status === 'running'
  const headerLabel = plan.status === 'deriving'
    ? t('review.batch.derivingUnits')
    : terminal
      ? t('review.batch.bootstrapReport')
      : checkpointRunning
        ? t('review.batch.runningCheckpoint')
        : t('review.batch.processingUnits')

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4">
      <div className="flex min-w-0 items-center gap-3">
        {terminal
          ? <Sparkles className="size-4 shrink-0 text-primary" />
          : <Loader2 className="size-4 shrink-0 animate-spin text-sky-500" />}
        <h1 className="truncate text-sm font-semibold">{headerLabel}</h1>
        <span className={cn('rounded border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider', STATUS_TONE[plan.status])}>
          {plan.status}
        </span>
        <span className="text-xs text-muted-foreground">
          {t('review.batch.unitsProcessed', { completed, total: plan.units.length })}
        </span>
        {plan.checkpointPhases.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('review.batch.checkpointsProgress', {
              completed: plan.checkpointPhases.filter(p => p.status === 'completed').length,
              total: plan.checkpointPhases.length,
            })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {terminal
          ? (
              <>
                {hasUnfinished && (
                  <Button size="sm" disabled={resume.isPending} onClick={() => resume.mutate()}>
                    <Play className="size-3.5" />
                    {resume.isPending ? t('review.batch.resuming') : t('review.batch.resumeButton')}
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={archive.isPending} onClick={() => archive.mutate()}>
                  <Archive className="size-3.5" />
                  {archive.isPending ? t('review.batch.archiving') : t('review.batch.archiveButton')}
                </Button>
              </>
            )
          : (
              <Button size="sm" variant="outline" disabled={stop.isPending} onClick={() => stop.mutate()}>
                <StopCircle className="size-3.5" />
                {stop.isPending ? t('review.batch.stopping') : t('review.batch.stopButton')}
              </Button>
            )}
      </div>
    </header>
  )
}

function ReportBar({ plan }: { plan: BatchPlan }) {
  const { t } = useTranslation()
  const stats = useMemo(() => summarise(plan), [plan])
  return (
    <div className="flex shrink-0 items-center gap-4 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
      <span>
        <span className="text-emerald-700 dark:text-emerald-300">
          {t('review.batch.reportCompleted', { count: stats.completed })}
        </span>
      </span>
      <span>
        <span className="text-rose-700 dark:text-rose-300">
          {t('review.batch.reportFailed', { count: stats.failed })}
        </span>
      </span>
      <span>
        <span className="text-sky-700 dark:text-sky-300">
          {t('review.batch.reportProposalsApplied', { count: stats.applied })}
        </span>
      </span>
      {plan.baselineTag && (
        <span className="ml-auto">
          {t('review.batch.baselineTagLabel')}
          {' '}
          <code className="rounded bg-muted px-1 font-mono">{plan.baselineTag}</code>
        </span>
      )}
    </div>
  )
}

function UnitList({ plan, selectedRunId, activeRunId, onSelect }: {
  plan: BatchPlan
  selectedRunId: SkillRunId | null
  activeRunId: SkillRunId | null
  onSelect: (runId: SkillRunId | null) => void
}) {
  const chunks = useMemo(() => groupUnitsByCheckpoint(plan), [plan])
  const isTerminal = plan.status === 'completed' || plan.status === 'failed' || plan.status === 'stopped' || plan.status === 'archived'

  const perUnitLabel = plan.batchPolicy?.perUnitLabel ?? plan.batchPolicy?.perUnitSkillId
  const checkpointLabel = plan.batchPolicy?.checkpointLabel ?? plan.batchPolicy?.checkpointSkillId
  return (
    <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border bg-card/40 scrollbar-thin">
      {chunks.map((chunk, idx) => (
        <ChunkSection
          key={chunk.phase?.skillRunId ?? `chunk-${idx}`}
          chunkIndex={idx}
          chunk={chunk}
          isTerminal={isTerminal}
          perUnitLabel={perUnitLabel}
          checkpointLabel={checkpointLabel}
          selectedRunId={selectedRunId}
          activeRunId={activeRunId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

interface UnitChunk {
  units: readonly BatchUnit[]
  phase: BatchPlan['checkpointPhases'][number] | undefined
  isFinal: boolean
}

/**
 * Build the visual chunks.
 * For each committed checkpoint phase we group the units it consumed.
 * Remaining units are split into anticipated chunks,
 * using `batchPolicy.checkpointChunkSize`,
 * so the reviewer sees the structure before any checkpoint fires.
 *
 * When `checkpointRunAtEnd` is true we also surface the mandatory final pass,
 * even if units happen to divide evenly.
 * The orchestrator fires one more checkpoint with an empty unit list.
 */
function groupUnitsByCheckpoint(plan: BatchPlan): UnitChunk[] {
  const unitsById = new Map(plan.units.map(u => [u.id, u]))
  const consumed = new Set<string>()
  const chunks: UnitChunk[] = []
  for (const phase of plan.checkpointPhases) {
    const units: BatchUnit[] = []
    for (const id of phase.unitIds) {
      const unit = unitsById.get(id)
      if (unit) {
        units.push(unit)
        consumed.add(id)
      }
    }
    chunks.push({ units, phase, isFinal: false })
  }
  const leftovers = plan.units.filter(u => !consumed.has(u.id))
  const chunkSize = plan.batchPolicy?.checkpointChunkSize
  const runAtEnd = plan.batchPolicy?.checkpointRunAtEnd ?? false
  if (chunkSize && chunkSize > 0) {
    for (let i = 0; i < leftovers.length; i += chunkSize) {
      const slice = leftovers.slice(i, i + chunkSize)
      const isLastSlice = i + chunkSize >= leftovers.length
      chunks.push({ units: slice, phase: undefined, isFinal: isLastSlice && runAtEnd })
    }
    if (runAtEnd && leftovers.length > 0 && leftovers.length % chunkSize === 0)
      chunks.push({ units: [], phase: undefined, isFinal: true })
  }
  else if (leftovers.length > 0) {
    chunks.push({ units: leftovers, phase: undefined, isFinal: runAtEnd })
  }
  return chunks
}

type PhaseTone = 'completed' | 'failed' | 'running' | 'idle'

function aggregateUnitsTone(units: readonly BatchUnit[]): PhaseTone {
  if (units.length === 0)
    return 'idle'
  if (units.some(u => u.status === 'failed'))
    return 'failed'
  if (units.some(u => u.status === 'running'))
    return 'running'
  return units.every(u => u.status === 'completed') ? 'completed' : 'idle'
}

function ChunkSection({ chunkIndex, chunk, isTerminal, perUnitLabel, checkpointLabel, selectedRunId, activeRunId, onSelect }: {
  chunkIndex: number
  chunk: UnitChunk
  isTerminal: boolean
  perUnitLabel: string | undefined
  checkpointLabel: string | undefined
  selectedRunId: SkillRunId | null
  activeRunId: SkillRunId | null
  onSelect: (runId: SkillRunId | null) => void
}) {
  const { t } = useTranslation()
  const completedUnits = chunk.units.filter(u => u.status === 'completed').length
  const groupTone = aggregateUnitsTone(chunk.units)
  return (
    <>
      <PhaseSectionHeader
        title={perUnitLabel
          ? t('review.batch.groupWithLabel', { label: perUnitLabel, index: chunkIndex + 1 })
          : t('review.batch.group', { index: chunkIndex + 1 })}
        badge={`${completedUnits} / ${chunk.units.length}`}
        tone={groupTone}
      />
      <ul className="flex flex-col gap-1 px-2 py-1">
        {chunk.units.map(unit => (
          <UnitRow
            key={unit.id}
            unit={unit}
            actionLabel={perUnitLabel}
            active={unit.skillRunId === activeRunId && activeRunId !== null}
            selected={unit.skillRunId === selectedRunId && selectedRunId !== null}
            onSelect={() => onSelect(unit.skillRunId ?? null)}
          />
        ))}
      </ul>
      <PhaseSectionHeader
        title={(() => {
          const base = checkpointLabel
            ? t('review.batch.checkpointWithLabel', { label: checkpointLabel, index: chunkIndex + 1 })
            : t('review.batch.checkpoint', { index: chunkIndex + 1 })
          return chunk.isFinal && !chunk.phase ? t('review.batch.checkpointFinal', { base }) : base
        })()}
        badge={chunk.phase?.status === 'completed' ? '1 / 1' : '0 / 1'}
        tone={chunk.phase
          ? (chunk.phase.status === 'running' ? 'running' : chunk.phase.status === 'completed' ? 'completed' : 'failed')
          : 'idle'}
      />
      <ul className="flex flex-col gap-1 px-2 py-1">
        {chunk.phase
          ? (
              <CheckpointPhaseRow
                phase={chunk.phase}
                label={checkpointLabel}
                active={!!chunk.phase.skillRunId && chunk.phase.skillRunId === activeRunId}
                selected={!!chunk.phase.skillRunId && chunk.phase.skillRunId === selectedRunId}
                onSelect={() => onSelect(chunk.phase?.skillRunId ?? null)}
              />
            )
          : (
              <li className="rounded-md border border-dashed border-border/60 px-2.5 py-2 text-2xs text-muted-foreground">
                {isTerminal
                  ? t('review.batch.noCheckpointRecorded')
                  : chunk.units.length === 0
                    ? t('review.batch.finalValidationPass')
                    : t('review.batch.willRunAfterUnits')}
              </li>
            )}
      </ul>
    </>
  )
}

function PhaseSectionHeader({ title, badge, tone = 'idle' }: {
  title: string
  badge?: string
  tone?: 'idle' | 'running' | 'completed' | 'failed'
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-y border-border/60 bg-card/80 px-3 py-1.5 backdrop-blur">
      <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
      {badge && (
        <span className={cn(
          'rounded border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider',
          tone === 'running' && 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-300',
          tone === 'completed' && 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
          tone === 'failed' && 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-300',
          tone === 'idle' && 'border-border bg-muted/40 text-muted-foreground',
        )}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

const CHECKPOINT_PHASE_ICON: Record<BatchPlan['checkpointPhases'][number]['status'], ReactNode> = {
  running: <Loader2 className="size-3.5 animate-spin text-sky-500" />,
  completed: <CheckCircle2 className="size-3.5 text-emerald-500" />,
  failed: <StopCircle className="size-3.5 text-rose-500" />,
}

function CheckpointPhaseRow({ phase, label, active, selected, onSelect }: {
  phase: BatchPlan['checkpointPhases'][number]
  label: string | undefined
  active: boolean
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const inspectable = !!phase.skillRunId
  return (
    <li className="mt-1 border-t border-border/40 pt-1">
      <button
        type="button"
        disabled={!inspectable}
        onClick={onSelect}
        className={cn(
          'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
          selected
            ? 'border-primary/50 bg-primary/5'
            : 'border-border bg-background hover:border-border/80 hover:bg-muted/30',
          !inspectable && 'cursor-default opacity-70',
          active && !selected && 'ring-1 ring-sky-500/40',
        )}
      >
        <div className="mt-0.5 shrink-0">{CHECKPOINT_PHASE_ICON[phase.status]}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {label && (
              <span className="rounded border border-border bg-transparent px-1 py-0.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {label}
              </span>
            )}
            <span className="truncate text-xs font-medium text-foreground">{t('review.batch.checkpointTitle')}</span>
          </div>
          <p className="mt-0.5 text-2xs text-muted-foreground">{t('review.batch.checkpointCovers', { count: phase.unitIds.length })}</p>
          {phase.error && (
            <p className="mt-0.5 line-clamp-2 text-2xs text-rose-600 dark:text-rose-300">{phase.error}</p>
          )}
        </div>
      </button>
    </li>
  )
}

function UnitRow({ unit, actionLabel, active, selected, onSelect }: {
  unit: BatchUnit
  actionLabel: string | undefined
  active: boolean
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const inspectable = !!unit.skillRunId
  return (
    <li>
      <button
        type="button"
        disabled={!inspectable}
        onClick={onSelect}
        className={cn(
          'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
          selected
            ? 'border-primary/50 bg-primary/5'
            : 'border-border bg-background hover:border-border/80 hover:bg-muted/30',
          !inspectable && 'cursor-default opacity-70',
          active && !selected && 'ring-1 ring-sky-500/40',
        )}
      >
        <div className="mt-0.5 shrink-0">{UNIT_ICON[unit.status]}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {actionLabel && (
              <span className="rounded border border-border bg-transparent px-1 py-0.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {actionLabel}
              </span>
            )}
            <span className="truncate text-xs font-medium text-foreground">{unit.name}</span>
          </div>
          {(unit.proposalIds.length > 0 || unit.clarificationIds.length > 0) && (
            <div className="mt-0.5 flex gap-2 text-2xs text-muted-foreground">
              {unit.proposalIds.length > 0 && (
                <span className="flex items-center gap-0.5" title={t('review.batch.proposalsTooltip', { count: unit.proposalIds.length })}>
                  <ClipboardCheck className="size-3" />
                  {unit.proposalIds.length}
                </span>
              )}
              {unit.clarificationIds.length > 0 && (
                <span className="flex items-center gap-0.5" title={t('review.batch.clarificationsTooltip', { count: unit.clarificationIds.length })}>
                  <HelpCircle className="size-3" />
                  {unit.clarificationIds.length}
                </span>
              )}
            </div>
          )}
          {unit.error && (
            <p className="mt-0.5 line-clamp-2 text-2xs text-rose-600 dark:text-rose-300">{unit.error}</p>
          )}
        </div>
      </button>
    </li>
  )
}

function LogPane({ workspaceId, plan, selectedRunId }: {
  workspaceId: string
  plan: BatchPlan
  selectedRunId: SkillRunId | null
}) {
  const { t } = useTranslation()
  // Pull the run into the global store so SkillTranscript renders the stream.
  // The per-unit skill id comes from the plan's frozen policy, not a literal,
  // so a non-DDD ontology's per-unit skill works here too.
  const perUnitSkillId = plan.batchPolicy?.perUnitSkillId
  useEffect(() => {
    if (selectedRunId && perUnitSkillId)
      runStore.loadRun(workspaceId, selectedRunId, perUnitSkillId)
  }, [workspaceId, selectedRunId, perUnitSkillId])

  const run = useRun(workspaceId, selectedRunId ?? undefined)
  const selectedUnit = plan.units.find(u => u.skillRunId === selectedRunId)

  if (!selectedRunId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-card/20 text-center">
        <div className="max-w-xs text-xs text-muted-foreground">
          <FileText className="mx-auto size-5 text-muted-foreground/40" />
          <p className="mt-2">{t('review.batch.pickUnit')}</p>
        </div>
      </div>
    )
  }

  const events = run ? [...run.events] : []
  const running = run?.phase === 'streaming'
  const error = run?.error ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-2xs text-muted-foreground">
        <Terminal className="size-3" />
        <span className="font-medium text-foreground">
          {selectedUnit?.name ?? t('review.batch.unitLog')}
        </span>
        <span className="ml-auto font-mono">{selectedRunId.replace('skill-run-', '').slice(0, 8)}</span>
      </div>
      <SkillTranscript events={events} error={error} running={running} />
    </div>
  )
}

function isTerminal(status: BatchStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped'
}

function lastFinishedRunId(units: readonly BatchUnit[]): SkillRunId | null {
  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i]!
    if (unit.skillRunId && (unit.status === 'completed' || unit.status === 'failed'))
      return unit.skillRunId
  }
  return null
}

function summarise(plan: BatchPlan): { completed: number, failed: number, applied: number } {
  let completed = 0
  let failed = 0
  let applied = 0
  for (const unit of plan.units) {
    if (unit.status === 'completed') {
      completed += 1
      applied += unit.proposalIds.length
    }
    if (unit.status === 'failed')
      failed += 1
  }
  return { completed, failed, applied }
}

// Selected unit follows the active running unit.
// Manual clicks override until the next active change.
function useTrackedRunId(initial: SkillRunId | null, activeRunId: SkillRunId | null): [SkillRunId | null, (id: SkillRunId | null) => void] {
  const [selected, setSelected] = useState<SkillRunId | null>(initial)
  useEffect(() => {
    if (activeRunId)
      setSelected(activeRunId)
  }, [activeRunId])
  return [selected, setSelected]
}
