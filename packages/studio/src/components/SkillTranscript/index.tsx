import type { SkillEvent } from '@braidhq/schema'
import { useEffect, useRef } from 'react'
import { groupTranscript } from './groupTranscript'
import { Markdown } from './Markdown'
import { ToolGroup } from './ToolGroup'

interface SkillTranscriptProps {
  events: SkillEvent[]
  error: string | null
  running: boolean
}

export function SkillTranscript({ events, error, running }: SkillTranscriptProps) {
  const items = groupTranscript(events)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the bottom when new events arrive,
  // so the latest output is always visible.
  // We compare scrollHeight to scrollTop+clientHeight,
  // to avoid stealing scroll when the user has scrolled up to read.
  useEffect(() => {
    const node = containerRef.current
    if (!node)
      return
    const nearBottom = node.scrollHeight - node.clientHeight - node.scrollTop < 120
    if (nearBottom)
      node.scrollTop = node.scrollHeight
  }, [events])

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 font-mono text-xs leading-relaxed">
      {events.length === 0 && !running && !error && (
        <div className="text-muted-foreground/60">Output appears here.</div>
      )}
      {items.map(item =>
        item.kind === 'tool-group'
          ? <ToolGroup key={item.key} calls={item.calls} />
          : <TranscriptLine key={item.key} event={item.event} />,
      )}
      {running && <div className="text-muted-foreground">▶ running…</div>}
      {error && (
        <div className="text-destructive">
          !
          {' '}
          {error}
        </div>
      )}
    </div>
  )
}

function TranscriptLine({ event }: { event: SkillEvent }) {
  switch (event.type) {
    case 'started':
      return (
        <div className="my-3 rounded-r border-l-2 border-primary bg-primary/5 py-1.5 pl-3 pr-2 font-sans first:mt-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {event.resumed ? 'Follow-up' : 'Prompt'}
          </div>
          <div className="mt-0.5 text-sm text-foreground">{event.args}</div>
        </div>
      )
    case 'session-started':
      // Side-channel event, the session id is captured by the runner state.
      return null
    case 'message':
      return <Markdown text={event.text} />
    case 'tool-call':
    case 'tool-result':
      return null
    case 'artifact-written':
      return (
        <div className="text-emerald-400">
          [artifact]
          {' '}
          {event.artifactKind}
          {' '}
          {event.artifactId}
          {' '}
          →
          {' '}
          {event.path}
        </div>
      )
    case 'completed':
      return (
        <div className="text-muted-foreground">
          [completed] exit=
          {event.exitCode}
        </div>
      )
    case 'error':
      return (
        <div className="text-destructive">
          [error]
          {' '}
          {event.message}
        </div>
      )
    case 'thinking':
      // The model's reasoning.
      // Collapsed by default so it never buries the actual output,
      // but available when a reviewer wants the why.
      return (
        <details className="my-1 font-sans text-muted-foreground/70">
          <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider">
            Thinking
          </summary>
          <div className="mt-1 whitespace-pre-wrap border-l-2 border-muted pl-3 italic">
            {event.text}
          </div>
        </details>
      )
    case 'rate-limit':
      return (
        <div className="text-amber-400">
          ⏳ waiting on rate limit
          {event.resetsAt ? ` (resets ${new Date(event.resetsAt * 1000).toLocaleTimeString()})` : ''}
        </div>
      )
    case 'usage': {
      const parts = [
        event.costUsd != null ? `$${event.costUsd.toFixed(3)}` : null,
        event.durationMs != null ? `${(event.durationMs / 1000).toFixed(1)}s` : null,
        event.turns != null ? `${event.turns} turns` : null,
      ].filter(Boolean)
      return parts.length > 0
        ? <div className="mt-1 text-muted-foreground/60">{parts.join(' · ')}</div>
        : null
    }
    default:
      return null
  }
}
