import type { ReactorCheckpoint, ReactorCycle, ReactorCycleId, ReactorUnit } from '@braidhq/schema'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertCircle, CheckCircle2, CircleDashed, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

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
  const list = useQuery({
    queryKey: ['reactor-cycles', workspaceId],
    queryFn: () => api.listReactorCycles(workspaceId),
  })
  const [selectedId, setSelectedId] = useState<ReactorCycleId | null>(null)
  const passes = list.data?.items ?? []
  const effectiveSelected = selectedId ?? passes[0]?.id ?? null

  const detail = useQuery({
    queryKey: ['reactor-cycles', workspaceId, effectiveSelected],
    queryFn: () => api.getReactorCycle(workspaceId, effectiveSelected!),
    enabled: effectiveSelected !== null,
  })

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card/30">
        <header className="border-b border-border px-3 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Reactor passes
        </header>
        {list.isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>}
        {list.error && <p className="px-3 py-2 text-xs text-destructive">Failed to load.</p>}
        {!list.isLoading && passes.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            No reactor passes yet. Enable
            {' '}
            <code className="font-mono">reactor.enabled</code>
            {' '}
            in
            {' '}
            <code className="font-mono">PRODUCT.md</code>
            {' '}
            and sync a source.
          </p>
        )}
        <ul className="flex-1 overflow-y-auto">
          {passes.map(p => (
            <CycleListItem
              key={p.id}
              cycle={p}
              selected={p.id === effectiveSelected}
              onSelect={() => setSelectedId(p.id)}
            />
          ))}
        </ul>
      </aside>
      <main className="flex flex-1 flex-col overflow-y-auto">
        {!effectiveSelected && (
          <EmptyState
            icon={Activity}
            title="No Cycle Selected"
            description="Pick a cycle from the list to see its per-unit timeline."
          />
        )}
        {effectiveSelected && detail.data && <CycleDetail cycle={detail.data} />}
      </main>
    </div>
  )
}

function CycleListItem({ cycle, selected, onSelect }: {
  cycle: ReactorCycle
  selected: boolean
  onSelect: () => void
}) {
  const counts = useUnitCounts(cycle.units)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full flex-col items-stretch gap-1 border-b border-border/60 px-3 py-2 text-left text-xs hover:bg-accent/40',
          selected && 'bg-accent/60',
        )}
      >
        <span className="flex items-center gap-2">
          <CycleStatusIcon cycle={cycle} />
          <span className="font-mono text-2xs text-foreground">{cycle.sourceId}</span>
          <span className="ml-auto text-2xs text-muted-foreground">
            {timeAgo(cycle.startedAt)}
          </span>
        </span>
        <span className="text-2xs text-muted-foreground">
          {cycle.status === 'throttled'
            ? (cycle.throttledReason ?? 'throttled')
            : `${counts.success}/${cycle.units.length} units · ${cycle.status}`}
        </span>
      </button>
    </li>
  )
}

function CycleDetail({ cycle }: { cycle: ReactorCycle }) {
  const counts = useUnitCounts(cycle.units)
  return (
    <article className="flex flex-col gap-4 p-4">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <CycleStatusIcon cycle={cycle} />
          <h2 className="font-medium text-foreground">
            Reactor cycle on
            {' '}
            <span className="font-mono">{cycle.sourceId}</span>
          </h2>
        </div>
        <p className="text-2xs text-muted-foreground">
          Started
          {' '}
          {new Date(cycle.startedAt).toLocaleString()}
          {cycle.completedAt && (
            <>
              {' · finished '}
              {new Date(cycle.completedAt).toLocaleString()}
            </>
          )}
        </p>
        <p className="text-2xs text-muted-foreground">
          {counts.success}
          {' success · '}
          {counts.failure}
          {' failed · '}
          {counts.running}
          {' running · '}
          {counts.queued}
          {' queued'}
        </p>
      </header>
      {cycle.status === 'throttled' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-2xs text-foreground">
          Dropped:
          {' '}
          {cycle.throttledReason ?? 'rolling 1h cap reached'}
          .
        </div>
      )}
      {cycle.units.length === 0 && cycle.status !== 'throttled' && (
        <p className="text-2xs text-muted-foreground">No units required dispatch. The diff was empty.</p>
      )}
      {cycle.units.length > 0 && (
        <section>
          <h3 className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Units</h3>
          <ol className="space-y-1">
            {cycle.units.map((unit, idx) => (
              <UnitRow key={`${unit.path}-${idx}`} unit={unit} index={idx + 1} />
            ))}
          </ol>
        </section>
      )}
      {cycle.checkpoint && (
        <section>
          <h3 className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Checkpoint</h3>
          <CheckpointRow checkpoint={cycle.checkpoint} />
        </section>
      )}
    </article>
  )
}

function UnitRow({ unit, index }: { unit: ReactorUnit, index: number }) {
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
          : unit.startedAt ? 'running…' : ''}
      </span>
    </li>
  )
}

function CheckpointRow({ checkpoint }: { checkpoint: ReactorCheckpoint }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1 text-2xs">
      <CheckpointStatusIcon status={checkpoint.status} />
      <span className="font-mono text-foreground">{checkpoint.skillId}</span>
      <span className="ml-auto text-2xs text-muted-foreground">
        {checkpoint.startedAt && checkpoint.completedAt
          ? `${secondsBetween(checkpoint.startedAt, checkpoint.completedAt)}s`
          : checkpoint.startedAt ? 'running…' : checkpoint.status}
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

function timeAgo(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then))
    return ''
  const delta = Math.max(0, Date.now() - then)
  const m = Math.floor(delta / 60_000)
  if (m < 1)
    return 'just now'
  if (m < 60)
    return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)
    return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function secondsBetween(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000))
}
