import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { workspaceEventsUrl } from '@/lib/api'
import { TopBanner } from './TopBanner'

interface ReactorBannerProps {
  workspaceId: string | null
  /** Surface activation hook; clicking the "Open Activity" link drops the user on the Activity page. */
  onOpenActivity: () => void
}

interface ReactorPassProgress {
  readonly passId: string
  readonly sourceId: string
  readonly totalUnits: number
  readonly processed: number
}

/**
 * Top-of-app banner surfacing the active reactor pass. Subscribes to
 * the workspace SSE stream directly and tracks progress via the
 * `reactor.unit.completed` events the reactor emits per unit. The
 * detail-pane lives on the dedicated Activity surface; this banner is
 * intentionally minimal so it does not crowd out the parallel batch /
 * run banners that may stack on top during a busy session.
 *
 * Throttle events flash an amber notice that auto-dismisses after a
 * few seconds — they would otherwise pile up across consecutive
 * dropped deliveries.
 */
export function ReactorBanner({ workspaceId, onOpenActivity }: ReactorBannerProps) {
  const [pass, setPass] = useState<ReactorPassProgress | null>(null)
  const [throttled, setThrottled] = useState<{ sourceId: string, limit: number } | null>(null)

  useEffect(() => {
    if (!workspaceId)
      return
    setPass(null)
    setThrottled(null)
    const source = new EventSource(workspaceEventsUrl(workspaceId))

    source.addEventListener('reactor.dispatched', (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as {
          passId: string
          sourceId: string
          totalUnits: number
        }
        setPass({ passId: event.passId, sourceId: event.sourceId, totalUnits: event.totalUnits, processed: 0 })
      }
      catch {
        // Malformed payload — ignore; next event resets cleanly.
      }
    })
    source.addEventListener('reactor.unit.completed', (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as {
          passId: string
          processed: number
          total: number
        }
        setPass(current => (current?.passId === event.passId
          ? { ...current, processed: event.processed, totalUnits: event.total }
          : current))
      }
      catch {
        // Same as above.
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

  useEffect(() => {
    if (!throttled)
      return
    const id = setTimeout(() => setThrottled(null), 6000)
    return () => clearTimeout(id)
  }, [throttled])

  if (!workspaceId || (!pass && !throttled))
    return null

  return (
    <>
      {pass && (
        <TopBanner
          tone="reactor"
          label="Reactor"
          detail={(
            <>
              processing
              {' '}
              <span className="font-mono">{pass.sourceId}</span>
              {' · '}
              {pass.processed}
              /
              {pass.totalUnits}
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
      {throttled && !pass && (
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
