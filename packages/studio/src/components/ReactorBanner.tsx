import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { workspaceEventsUrl } from '@/lib/api'

interface ReactorBannerProps {
  workspaceId: string | null
}

interface ReactorPassState {
  readonly sourceId: string
  readonly totalUnits: number
  /** Unix-ms when the pass started; used to render elapsed time. */
  readonly dispatchedAt: number
}

/**
 * Top-of-app banner that surfaces the active reactor pass: which
 * source is being re-extracted and how many units are queued. Lifecycle
 * is driven entirely by the SSE event stream: `reactor.dispatched`
 * opens the banner, `reactor.completed` clears it, `reactor.throttled`
 * flashes a brief notice that the dispatch was skipped.
 *
 * The reactor itself runs per-unit dispatches sequentially via
 * `SkillRunner`, so every per-unit `run.started` / `run.completed`
 * event already flows through the existing `InFlightRunBanner`. This
 * banner sits above it and gives the user the "you are in the middle
 * of a reactor pass over N units" context that the per-run banner
 * cannot express on its own.
 */
export function ReactorBanner({ workspaceId }: ReactorBannerProps) {
  const [pass, setPass] = useState<ReactorPassState | null>(null)
  const [throttled, setThrottled] = useState<{ sourceId: string, limit: number } | null>(null)

  useEffect(() => {
    if (!workspaceId)
      return
    const source = new EventSource(workspaceEventsUrl(workspaceId))

    source.addEventListener('reactor.dispatched', (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as {
          sourceId: string
          totalUnits: number
          at: string
        }
        setPass({
          sourceId: event.sourceId,
          totalUnits: event.totalUnits,
          dispatchedAt: Date.parse(event.at) || Date.now(),
        })
      }
      catch {
        // Malformed event payload — ignore. The next dispatch will
        // reset the banner cleanly.
      }
    })
    source.addEventListener('reactor.completed', () => {
      setPass(null)
    })
    source.addEventListener('reactor.throttled', (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as {
          sourceId: string
          limit: number
        }
        setThrottled({ sourceId: event.sourceId, limit: event.limit })
      }
      catch {
        setThrottled({ sourceId: '(unknown)', limit: 0 })
      }
    })

    return () => {
      source.close()
    }
  }, [workspaceId])

  // Auto-clear the throttle notice after a few seconds so it does not
  // pile up across consecutive throttled deliveries.
  useEffect(() => {
    if (!throttled)
      return
    const id = setTimeout(() => setThrottled(null), 6000)
    return () => clearTimeout(id)
  }, [throttled])

  const elapsed = useElapsed(pass?.dispatchedAt)

  if (!workspaceId || (!pass && !throttled))
    return null

  return (
    <>
      {pass && (
        <div className="flex items-center gap-3 border-b border-emerald-500/30 bg-emerald-500/5 px-4 py-1.5 text-xs">
          <Loader2 className="size-3 animate-spin text-emerald-600 dark:text-emerald-400" />
          <span className="font-medium text-foreground">Reactor</span>
          <span className="text-muted-foreground">
            processing
            {' '}
            {pass.totalUnits}
            {' '}
            unit
            {pass.totalUnits === 1 ? '' : 's'}
            {' '}
            from
            {' '}
            <span className="font-mono">{pass.sourceId}</span>
            {' · '}
            {elapsed}
            s elapsed
          </span>
        </div>
      )}
      {throttled && !pass && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-1.5 text-xs">
          <span className="font-medium text-foreground">Reactor</span>
          <span className="text-muted-foreground">
            throttled (cap
            {' '}
            {throttled.limit}
            /h reached) — sync on
            {' '}
            <span className="font-mono">{throttled.sourceId}</span>
            {' '}
            skipped; next dispatch unblocks once the rolling window slides.
          </span>
        </div>
      )}
    </>
  )
}

function useElapsed(dispatchedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!dispatchedAt)
      return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [dispatchedAt])
  if (!dispatchedAt)
    return 0
  return Math.max(0, Math.floor((now - dispatchedAt) / 1000))
}
