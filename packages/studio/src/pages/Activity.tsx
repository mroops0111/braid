import type { ReactorCheckpoint, ReactorCycle, ReactorCycleId, ReactorUnit } from '@braidhq/schema'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertCircle, CheckCircle2, CircleDashed, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ActivityPageProps {
  workspaceId: string
}

/**
 * Activity surface — the rich complement to the top-of-app
 * `<ReactorBanner>`. Lists every reactor pass for the workspace
 * (newest first) on the left; renders the selected pass's unit
 * timeline + checkpoint on the right. Live-updates via the
 * `useWorkspaceEvents` query-invalidation hook the App mounts globally,
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
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-card/30">
        <header className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
            <PassListItem
              key={p.id}
              pass={p}
              selected={p.id === effectiveSelected}
              onSelect={() => setSelectedId(p.id)}
            />
          ))}
        </ul>
      </aside>
      <main className="flex flex-1 flex-col overflow-y-auto">
        {!effectiveSelected && (
          <EmptyPanel
            icon={Activity}
            title="No pass selected"
            detail="Pick a pass from the list to see its per-unit timeline."
          />
        )}
        {effectiveSelected && detail.data && <PassDetail pass={detail.data} />}
      </main>
    </div>
  )
}

function PassListItem({ pass, selected, onSelect }: {
  pass: ReactorCycle
  selected: boolean
  onSelect: () => void
}) {
  const counts = useUnitCounts(pass.units)
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
          <PassStatusIcon pass={pass} />
          <span className="font-mono text-[11px] text-foreground">{pass.sourceId}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {timeAgo(pass.startedAt)}
          </span>
        </span>
        <span className="text-[10px] text-muted-foreground">
          {pass.status === 'throttled'
            ? (pass.throttledReason ?? 'throttled')
            : `${counts.success}/${pass.units.length} units · ${pass.status}`}
        </span>
      </button>
    </li>
  )
}

function PassDetail({ pass }: { pass: ReactorCycle }) {
  const counts = useUnitCounts(pass.units)
  return (
    <article className="flex flex-col gap-4 p-4">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <PassStatusIcon pass={pass} />
          <h2 className="font-medium text-foreground">
            Reactor pass on
            {' '}
            <span className="font-mono">{pass.sourceId}</span>
          </h2>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Started
          {' '}
          {new Date(pass.startedAt).toLocaleString()}
          {pass.completedAt && (
            <>
              {' · finished '}
              {new Date(pass.completedAt).toLocaleString()}
            </>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">
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
      {pass.status === 'throttled' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-foreground">
          Dropped:
          {' '}
          {pass.throttledReason ?? 'rolling 1h cap reached'}
          .
        </div>
      )}
      {pass.units.length === 0 && pass.status !== 'throttled' && (
        <p className="text-[11px] text-muted-foreground">No units required dispatch — the diff was empty.</p>
      )}
      {pass.units.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Units</h3>
          <ol className="space-y-1">
            {pass.units.map((unit, idx) => (
              <UnitRow key={`${unit.path}-${idx}`} unit={unit} index={idx + 1} />
            ))}
          </ol>
        </section>
      )}
      {pass.checkpoint && (
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Checkpoint</h3>
          <CheckpointRow checkpoint={pass.checkpoint} />
        </section>
      )}
    </article>
  )
}

function UnitRow({ unit, index }: { unit: ReactorUnit, index: number }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1 text-[11px]">
      <UnitStatusIcon status={unit.status} />
      <span className="font-mono text-foreground">
        {index}
        .
      </span>
      <span className="truncate font-mono">{unit.path}</span>
      <span className="ml-auto text-[10px] text-muted-foreground">
        {unit.startedAt && unit.completedAt
          ? `${secondsBetween(unit.startedAt, unit.completedAt)}s`
          : unit.startedAt ? 'running…' : ''}
      </span>
    </li>
  )
}

function CheckpointRow({ checkpoint }: { checkpoint: ReactorCheckpoint }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1 text-[11px]">
      <CheckpointStatusIcon status={checkpoint.status} />
      <span className="font-mono text-foreground">{checkpoint.skillId}</span>
      <span className="ml-auto text-[10px] text-muted-foreground">
        {checkpoint.startedAt && checkpoint.completedAt
          ? `${secondsBetween(checkpoint.startedAt, checkpoint.completedAt)}s`
          : checkpoint.startedAt ? 'running…' : checkpoint.status}
      </span>
    </div>
  )
}

function PassStatusIcon({ pass }: { pass: ReactorCycle }) {
  if (pass.status === 'throttled')
    return <AlertCircle className="size-3 text-amber-600 dark:text-amber-400" />
  if (pass.status === 'completed') {
    const failures = pass.units.filter(u => u.status === 'failure').length
    if (failures > 0)
      return <AlertCircle className="size-3 text-amber-600 dark:text-amber-400" />
    return <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
  }
  return <Loader2 className="size-3 animate-spin text-emerald-600 dark:text-emerald-400" />
}

function UnitStatusIcon({ status }: { status: ReactorUnit['status'] }) {
  if (status === 'success')
    return <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
  if (status === 'failure')
    return <AlertCircle className="size-3 text-rose-600 dark:text-rose-400" />
  if (status === 'running')
    return <Loader2 className="size-3 animate-spin text-emerald-600 dark:text-emerald-400" />
  return <CircleDashed className="size-3 text-muted-foreground" />
}

function CheckpointStatusIcon({ status }: { status: ReactorCheckpoint['status'] }) {
  if (status === 'success')
    return <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
  if (status === 'failure')
    return <AlertCircle className="size-3 text-rose-600 dark:text-rose-400" />
  if (status === 'running')
    return <Loader2 className="size-3 animate-spin text-emerald-600 dark:text-emerald-400" />
  if (status === 'skipped')
    return <CircleDashed className="size-3 text-muted-foreground" />
  return <CircleDashed className="size-3 text-muted-foreground" />
}

function EmptyPanel({ icon: Icon, title, detail }: {
  icon: typeof Activity
  title: string
  detail: string
}) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-2 text-center text-xs text-muted-foreground">
      <Icon className="size-6 opacity-60" />
      <p className="font-medium text-foreground">{title}</p>
      <p>{detail}</p>
    </div>
  )
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
