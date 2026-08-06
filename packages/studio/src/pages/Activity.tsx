import type { ReactorCheckpoint, ReactorCycle, ReactorCycleId, ReactorUnit } from '@braidhq/schema'
import { Activity, AlertCircle, CheckCircle2, CircleDashed, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { SurfaceLayout } from '@/components/SurfaceLayout'
import { useLocaleFormat } from '@/lib/i18n'
import { useReactorCycle, useReactorCycles } from '@/lib/queries'

interface ActivityPageProps {
  workspaceId: string
}

/**
 * Activity surface, the rich complement to the top-of-app `<ReactorBanner>`.
 * Lists every reactor cycle for the workspace (newest first) on the left,
 * renders the selected cycle's unit timeline + checkpoint on the right.
 * Live-updates via the `useWorkspaceEvents` query-invalidation hook the App mounts globally,
 * so the page stays current without its own SSE wiring.
 */
export function ActivityPage({ workspaceId }: ActivityPageProps) {
  const { t } = useTranslation()
  const list = useReactorCycles(workspaceId)
  const [selectedId, setSelectedId] = useState<ReactorCycleId | null>(null)
  const passes = list.data?.items ?? []
  const effectiveSelected = selectedId ?? passes[0]?.id ?? null
  const detail = useReactorCycle(workspaceId, effectiveSelected)

  return (
    <div className="flex h-full flex-col">
      <SurfaceLayout
        listClassName="bg-card/30"
        list={(
          <>
            <header className="border-b border-border px-3 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('history.activity.reactorPasses')}
            </header>
            {list.isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">{t('common.loading')}</p>}
            {list.error && <p className="px-3 py-2 text-xs text-destructive">{t('history.activity.failedToLoad')}</p>}
            {!list.isLoading && passes.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                {t('history.activity.emptyPrefix')}
                {' '}
                <code className="font-mono">reactor.enabled</code>
                {' '}
                {t('history.activity.emptyMiddle')}
                {' '}
                <code className="font-mono">PRODUCT.md</code>
                {' '}
                {t('history.activity.emptySuffix')}
              </p>
            )}
            <ul className="flex-1 overflow-y-auto">
              {passes.map(cycle => (
                <CycleListItem
                  key={cycle.id}
                  cycle={cycle}
                  selected={cycle.id === effectiveSelected}
                  onSelect={() => setSelectedId(cycle.id)}
                />
              ))}
            </ul>
          </>
        )}
      >
        <div className="flex flex-1 flex-col overflow-y-auto">
          {!effectiveSelected && (
            <EmptyState
              icon={Activity}
              title={t('history.activity.noCycleTitle')}
              description={t('history.activity.noCycleDescription')}
            />
          )}
          {effectiveSelected && detail.data && <CycleDetail cycle={detail.data} />}
        </div>
      </SurfaceLayout>
    </div>
  )
}

function CycleListItem({ cycle, selected, onSelect }: {
  cycle: ReactorCycle
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const { formatRelativeTime } = useLocaleFormat()
  const counts = useUnitCounts(cycle.units)
  return (
    <ListRow active={selected} onClick={onSelect} className="flex-col gap-1 text-xs">
      <span className="flex items-center gap-2">
        <CycleStatusIcon cycle={cycle} />
        <span className="font-mono text-2xs text-foreground">{cycle.sourceId}</span>
        <span className="ml-auto text-2xs text-muted-foreground">
          {formatRelativeTime(cycle.startedAt)}
        </span>
      </span>
      <span className="text-2xs text-muted-foreground">
        {cycle.status === 'throttled'
          ? (cycle.throttledReason ?? 'throttled')
          : t('history.activity.cycleSummary', { success: counts.success, total: cycle.units.length, status: cycle.status })}
      </span>
    </ListRow>
  )
}

function CycleDetail({ cycle }: { cycle: ReactorCycle }) {
  const { t } = useTranslation()
  const { formatDateTime } = useLocaleFormat()
  const counts = useUnitCounts(cycle.units)
  return (
    <article className="flex flex-col gap-4 p-4">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <CycleStatusIcon cycle={cycle} />
          <h2 className="font-medium text-foreground">
            {t('history.activity.cycleTitle')}
            {' '}
            <span className="font-mono">{cycle.sourceId}</span>
          </h2>
        </div>
        <p className="text-2xs text-muted-foreground">
          {t('history.activity.startedAt')}
          {' '}
          {formatDateTime(cycle.startedAt)}
          {cycle.completedAt && (
            <>
              {' · '}
              {t('history.activity.finishedAt')}
              {' '}
              {formatDateTime(cycle.completedAt)}
            </>
          )}
        </p>
        <p className="text-2xs text-muted-foreground">
          {t('history.activity.countsSummary', { success: counts.success, failure: counts.failure, running: counts.running, queued: counts.queued })}
        </p>
      </header>
      {cycle.status === 'throttled' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-2xs text-foreground">
          {t('history.activity.dropped', { reason: cycle.throttledReason ?? t('history.activity.throttledCapReason') })}
        </div>
      )}
      {cycle.units.length === 0 && cycle.status !== 'throttled' && (
        <p className="text-2xs text-muted-foreground">{t('history.activity.noUnitsDispatched')}</p>
      )}
      {cycle.units.length > 0 && (
        <section>
          <h3 className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">{t('history.activity.unitsTitle')}</h3>
          <ol className="space-y-1">
            {cycle.units.map((unit, idx) => (
              <UnitRow key={`${unit.path}-${idx}`} unit={unit} index={idx + 1} />
            ))}
          </ol>
        </section>
      )}
      {cycle.checkpoint && (
        <section>
          <h3 className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">{t('history.activity.checkpointTitle')}</h3>
          <CheckpointRow checkpoint={cycle.checkpoint} />
        </section>
      )}
    </article>
  )
}

function UnitRow({ unit, index }: { unit: ReactorUnit, index: number }) {
  const { t } = useTranslation()
  return (
    <li className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1 text-2xs">
      <UnitStatusIcon status={unit.status} />
      <span className="font-mono text-foreground">
        {index}
        .
      </span>
      <span className="truncate font-mono">{unit.path}</span>
      <span className="ml-auto text-2xs text-muted-foreground">
        {unit.startedAt && unit.completedAt
          ? `${secondsBetween(unit.startedAt, unit.completedAt)}s`
          : unit.startedAt ? t('history.activity.runningInline') : ''}
      </span>
    </li>
  )
}

function CheckpointRow({ checkpoint }: { checkpoint: ReactorCheckpoint }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1 text-2xs">
      <CheckpointStatusIcon status={checkpoint.status} />
      <span className="font-mono text-foreground">{checkpoint.skillId}</span>
      <span className="ml-auto text-2xs text-muted-foreground">
        {checkpoint.startedAt && checkpoint.completedAt
          ? `${secondsBetween(checkpoint.startedAt, checkpoint.completedAt)}s`
          : checkpoint.startedAt ? t('history.activity.runningInline') : checkpoint.status}
      </span>
    </div>
  )
}

function CycleStatusIcon({ cycle }: { cycle: ReactorCycle }) {
  if (cycle.status === 'throttled')
    return <AlertCircle className="size-3 text-amber-600 dark:text-amber-400" />
  if (cycle.status === 'completed') {
    const failures = cycle.units.filter(u => u.status === 'failure').length
    if (failures > 0)
      return <AlertCircle className="size-3 text-amber-600 dark:text-amber-400" />
    return <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
  }
  return <Loader2 className="size-3 animate-spin text-sky-600 dark:text-sky-400" />
}

function UnitStatusIcon({ status }: { status: ReactorUnit['status'] }) {
  if (status === 'success')
    return <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
  if (status === 'failure')
    return <AlertCircle className="size-3 text-rose-600 dark:text-rose-400" />
  if (status === 'running')
    return <Loader2 className="size-3 animate-spin text-sky-600 dark:text-sky-400" />
  return <CircleDashed className="size-3 text-muted-foreground" />
}

function CheckpointStatusIcon({ status }: { status: ReactorCheckpoint['status'] }) {
  if (status === 'success')
    return <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
  if (status === 'failure')
    return <AlertCircle className="size-3 text-rose-600 dark:text-rose-400" />
  if (status === 'running')
    return <Loader2 className="size-3 animate-spin text-sky-600 dark:text-sky-400" />
  if (status === 'skipped')
    return <CircleDashed className="size-3 text-muted-foreground" />
  return <CircleDashed className="size-3 text-muted-foreground" />
}

function useUnitCounts(units: readonly ReactorUnit[]): {
  success: number
  failure: number
  running: number
  queued: number
} {
  return useMemo(() => {
    const counts = { success: 0, failure: 0, running: 0, queued: 0 }
    for (const unit of units)
      counts[unit.status]++
    return counts
  }, [units])
}

function secondsBetween(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000))
}
