import type { SkillEvent, SkillManifest } from '@telos/schema'
import { Play } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useSkills } from '@/lib/queries'
import { runSkillStream } from '@/lib/sse'

interface SkillsPageProps {
  workspaceId: string
}

export function SkillsPage({ workspaceId }: SkillsPageProps) {
  const { data } = useSkills(workspaceId)
  const [selected, setSelected] = useState<SkillManifest | null>(null)

  if (!data)
    return <div className="p-4 text-sm text-muted-foreground">Loading skills…</div>

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0 overflow-y-auto scrollbar-thin border-r border-border">
        <ul>
          {data.items.map(manifest => (
            <li key={manifest.id} className="relative">
              {selected?.id === manifest.id && (
                <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
              )}
              <button
                type="button"
                onClick={() => setSelected(manifest)}
                className={`flex w-full items-start gap-2 border-b border-border px-4 py-3 text-left transition-colors duration-150 hover:bg-accent ${
                  selected?.id === manifest.id ? 'bg-accent' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-foreground">
                      /
                      {manifest.frontmatter.name}
                    </span>
                    <Badge variant="outline" className="text-[10px] uppercase">{manifest.origin}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {manifest.frontmatter.description}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {selected
        ? (
            <SkillRunner workspaceId={workspaceId} skill={selected} key={selected.id} />
          )
        : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a skill on the left.
            </div>
          )}
    </div>
  )
}

interface SkillRunnerProps {
  workspaceId: string
  skill: SkillManifest
}

function SkillRunner({ workspaceId, skill }: SkillRunnerProps) {
  const [args, setArgs] = useState('')
  const [events, setEvents] = useState<SkillEvent[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const run = async () => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setEvents([])
    setError(null)
    setRunning(true)
    try {
      await runSkillStream({
        url: api.skillRunUrl(workspaceId, skill.id),
        args,
        signal: abortRef.current.signal,
        onEvent: event => setEvents(prev => [...prev, event]),
        onError: err => setError(err.message),
      })
    }
    finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="font-mono text-sm text-foreground">
          /
          {skill.frontmatter.name}
        </span>
        <span className="text-xs text-muted-foreground">{skill.frontmatter.description}</span>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Input
          placeholder={skill.frontmatter.argumentHint ?? 'args…'}
          value={args}
          onChange={e => setArgs(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !running)
              run()
          }}
          disabled={running}
          className="flex-1 font-mono"
        />
        <Button size="sm" onClick={run} disabled={running}>
          <Play />
          {running ? 'Running…' : 'Run'}
        </Button>
      </div>
      <SkillTranscript events={events} error={error} running={running} />
    </div>
  )
}

interface SkillTranscriptProps {
  events: SkillEvent[]
  error: string | null
  running: boolean
}

function SkillTranscript({ events, error, running }: SkillTranscriptProps) {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-card px-4 py-3 font-mono text-xs leading-relaxed">
      {events.length === 0 && !running && !error && (
        <div className="text-muted-foreground/60">Output appears here.</div>
      )}
      {events.map((event, index) => (
        <TranscriptLine key={index} event={event} />
      ))}
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
      return <div className="text-foreground whitespace-pre-wrap">{event.text}</div>
    case 'tool-call':
      return (
        <div className="text-amber-400">
          [tool]
          {' '}
          {event.tool}
          <span className="text-muted-foreground">
            {' '}
            {JSON.stringify(event.args).slice(0, 120)}
          </span>
        </div>
      )
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
