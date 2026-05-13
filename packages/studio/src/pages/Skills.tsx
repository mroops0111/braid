import type { SkillEvent, SkillManifest } from '@telos/schema'
import { ChevronRight, Play, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
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
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-primary" />
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
            <div className="flex-1">
              <EmptyState
                icon={Sparkles}
                title="Pick a skill"
                description="Select a skill on the left to run it against this workspace."
              />
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

function ToolCallLine({ tool, args }: { tool: string, args: unknown }) {
  const compact = formatArgsPreview(args)
  const expanded = JSON.stringify(args, null, 2)
  return (
    <details className="group my-0.5 rounded border border-border/40 bg-muted/20 open:bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 marker:hidden hover:bg-accent/40">
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90" />
        <span className="font-medium text-amber-400">{tool}</span>
        {compact && (
          <span className="truncate text-muted-foreground/80">{compact}</span>
        )}
      </summary>
      <pre className="overflow-x-auto border-t border-border/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {expanded}
      </pre>
    </details>
  )
}

function formatArgsPreview(args: unknown): string {
  if (args === null || args === undefined)
    return ''
  if (typeof args !== 'object') {
    return String(args).slice(0, 80)
  }
  const record = args as Record<string, unknown>
  // Surface the most useful field first — command for Bash, file_path for Read, etc.
  const interesting = record.command ?? record.file_path ?? record.path ?? record.query ?? record.url
  if (typeof interesting === 'string') {
    return interesting.length > 80 ? `${interesting.slice(0, 77)}…` : interesting
  }
  const json = JSON.stringify(args)
  return json.length > 80 ? `${json.slice(0, 77)}…` : json
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
      return <ToolCallLine tool={event.tool} args={event.args} />

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
