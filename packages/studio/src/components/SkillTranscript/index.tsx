import type { SkillEvent } from '@telos/schema'
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
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-card px-4 py-3 font-mono text-xs leading-relaxed">
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
        <div className="text-muted-foreground">
          [started] runId=
          {event.runId}
        </div>
      )
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
    default:
      return null
  }
}
