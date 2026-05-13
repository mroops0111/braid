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
import { cn } from '@/lib/utils'

type ToolCallEvent = Extract<SkillEvent, { type: 'tool-call' }>
type ToolResultEvent = Extract<SkillEvent, { type: 'tool-result' }>

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

interface PairedCall {
  call: ToolCallEvent
  result?: ToolResultEvent
}

type TranscriptItem =
  | { kind: 'event', event: SkillEvent, key: string }
  | { kind: 'tool-group', calls: PairedCall[], key: string }

function groupTranscript(events: SkillEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  let i = 0
  while (i < events.length) {
    const ev = events[i]!
    if (ev.type === 'tool-call' || ev.type === 'tool-result') {
      const calls: PairedCall[] = []
      const byId = new Map<string, PairedCall>()
      const startIndex = i
      while (i < events.length) {
        const cur = events[i]!
        if (cur.type === 'tool-call') {
          const paired: PairedCall = { call: cur }
          calls.push(paired)
          if (cur.toolCallId)
            byId.set(cur.toolCallId, paired)
          i++
        }
        else if (cur.type === 'tool-result') {
          const matched = byId.get(cur.toolCallId)
          if (matched) {
            matched.result = cur
          }
          else {
            // Orphan result — attach as a synthetic entry so it isn't lost.
            calls.push({
              call: {
                type: 'tool-call',
                tool: '(unknown tool)',
                args: null,
                toolCallId: cur.toolCallId,
              },
              result: cur,
            })
          }
          i++
        }
        else {
          break
        }
      }
      items.push({ kind: 'tool-group', calls, key: `g${startIndex}` })
    }
    else {
      items.push({ kind: 'event', event: ev, key: `e${i}` })
      i++
    }
  }
  return items
}

function ToolGroup({ calls }: { calls: PairedCall[] }) {
  if (calls.length === 1) {
    return <ToolCallRow paired={calls[0]!} />
  }
  const failed = calls.filter(c => c.result?.isError).length
  return (
    <details className="group my-1 rounded border border-border/40 bg-muted/20 open:bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 marker:hidden hover:bg-accent/40">
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90" />
        <span className="text-amber-400">
          {calls.length}
          {' '}
          tool calls
        </span>
        {failed > 0 && (
          <span className="text-red-400">
            ·
            {' '}
            {failed}
            {' '}
            failed
          </span>
        )}
      </summary>
      <div className="space-y-0.5 border-t border-border/40 px-2 py-1.5">
        {calls.map((paired, idx) => (
          <ToolCallRow key={paired.call.toolCallId ?? idx} paired={paired} />
        ))}
      </div>
    </details>
  )
}

function ToolCallRow({ paired }: { paired: PairedCall }) {
  const { call, result } = paired
  const isError = result?.isError === true
  const compact = formatArgsPreview(call.args)
  const argsJson = call.args === null ? '' : JSON.stringify(call.args, null, 2)
  return (
    <details
      className={cn(
        'group/row my-0.5 rounded border bg-background/50 open:bg-background/80',
        isError ? 'border-red-500/40' : 'border-border/40',
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 marker:hidden hover:bg-accent/40">
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-open/row:rotate-90" />
        <span className={cn('font-medium', isError ? 'text-red-400' : 'text-amber-400')}>{call.tool}</span>
        {compact && (
          <span className="truncate text-muted-foreground/80">{compact}</span>
        )}
        {isError && (
          <span className="ml-auto rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-red-400">
            error
          </span>
        )}
      </summary>
      <div className="border-t border-border/40 px-2 py-1.5">
        {argsJson && (
          <>
            <SectionLabel>Args</SectionLabel>
            <pre className="overflow-x-auto text-[11px] leading-relaxed text-muted-foreground">{argsJson}</pre>
          </>
        )}
        {result && (
          <>
            <SectionLabel className="mt-2">{isError ? 'Error output' : 'Result'}</SectionLabel>
            <pre
              className={cn(
                'overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed',
                isError ? 'text-red-300' : 'text-muted-foreground',
              )}
            >
              {result.output || '(empty)'}
            </pre>
          </>
        )}
      </div>
    </details>
  )
}

function SectionLabel({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <div className={cn('text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70', className)}>
      {children}
    </div>
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
    case 'tool-result':
      // Rendered inside a ToolGroup; should not appear here.
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
