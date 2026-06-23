import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, workspaceEventsUrl } from '@/lib/api'
import { TopBanner } from './TopBanner'

interface ReactorBannerProps {
  workspaceId: string | null
  /** Surface activation hook; clicking the "Open Activity" link drops the user on the Activity page. */
  onOpenActivity: () => void
}

/**
 * Top-of-app banner surfacing the active reactor pass. Reads the active
 * pass from the same `reactor-passes` query the Activity page uses;
 * `useWorkspaceEvents` invalidates that query on every reactor SSE event,
 * so the banner stays live without its own EventSource. Mid-pass mount
 * works because the query returns the in-flight pass from the API.
 *
 * The throttle notice still listens to SSE directly: a throttled pass is
 * a transient event (no persisted "in-flight" state to query), and it
 * auto-dismisses after a few seconds.
 */
export function ReactorBanner({ workspaceId, onOpenActivity }: ReactorBannerProps) {
  const passesQuery = useQuery({
    queryKey: ['reactor-passes', workspaceId],
    queryFn: () => api.listReactorPasses(workspaceId as string),
    enabled: workspaceId !== null,
  })
  const active = (passesQuery.data?.items ?? []).find(p => p.status === 'dispatched' || p.status === 'running')

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
            <button
              type="button"
              onClick={onOpenActivity}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Open Activity →
            </button>
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
