import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { workspaceEventsUrl } from '@/lib/api'
import { useReactorCycles } from '@/lib/queries'
import { TopBanner } from './TopBanner'
import { Button } from './ui/button'

interface ReactorBannerProps {
  workspaceId: string | null
  /** Surface activation hook; clicking the "Open Activity" link drops the user on the Activity page. */
  onOpenActivity: () => void
}

/**
 * Top-of-app banner surfacing the active reactor cycle. Reads the active
 * cycle from the same `reactor-cycles` query the Activity page uses;
 * `useWorkspaceEvents` invalidates that query on every reactor SSE event,
 * so the banner stays live without its own EventSource. Mid-cycle mount
 * works because the query returns the in-flight cycle from the API.
 *
 * The throttle notice still listens to SSE directly: a throttled cycle is
 * a transient event (no persisted "in-flight" state to query), and it
 * auto-dismisses after a few seconds.
 */
export function ReactorBanner({ workspaceId, onOpenActivity }: ReactorBannerProps) {
  const { data: cycles } = useReactorCycles(workspaceId)
  const active = (cycles?.items ?? []).find(c => c.status === 'dispatched' || c.status === 'running')

  const [throttled, setThrottled] = useState<{ sourceId: string, limit: number } | null>(null)

  useEffect(() => {
    if (!workspaceId)
      return
    setThrottled(null)
    const source = new EventSource(workspaceEventsUrl(workspaceId))
    source.addEventListener('reactor.throttled', (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as { sourceId: string, limit: number }
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

  useEffect(() => {
    if (!throttled)
      return
    const id = setTimeout(() => setThrottled(null), 6000)
    return () => clearTimeout(id)
  }, [throttled])

  if (!workspaceId || (!active && !throttled))
    return null

  const processed = active ? active.units.filter(u => u.status === 'success' || u.status === 'failure').length : 0
  const totalUnits = active?.units.length ?? 0

  return (
    <>
      {active && (
        <TopBanner
          tone="reactor"
          label="Reactor"
          detail={(
            <>
              processing
              {' '}
              <span className="font-mono">{active.sourceId}</span>
              {' · '}
              {processed}
              /
              {totalUnits}
              {' units'}
            </>
          )}
          actions={(
            <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]" onClick={onOpenActivity}>
              <ArrowRight className="size-3" />
              Open Activity
            </Button>
          )}
        />
      )}
      {throttled && !active && (
        <TopBanner
          tone="warning"
          label="Reactor"
          icon={AlertTriangle}
          detail={(
            <>
              throttled (cap
              {' '}
              {throttled.limit}
              /h reached) — sync on
              {' '}
              <span className="font-mono">{throttled.sourceId}</span>
              {' '}
              skipped; next dispatch unblocks once the rolling window slides.
            </>
          )}
        />
      )}
    </>
  )
}
