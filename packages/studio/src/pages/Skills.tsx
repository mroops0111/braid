import type { SkillEvent, SkillManifest } from '@telos/schema'
import { Play, Plus, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { SkillTranscript } from '@/components/SkillTranscript'
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
            <ListRow
              key={manifest.id}
              active={selected?.id === manifest.id}
              onClick={() => setSelected(manifest)}
              className="items-start gap-2"
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
            </ListRow>
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
  const [sessionId, setSessionId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const reset = () => {
    abortRef.current?.abort()
    const sessionToForget = sessionId
    setEvents([])
    setError(null)
    setSessionId(null)
    setArgs('')
    if (sessionToForget) {
      // Fire-and-forget: server reclaims the per-session cwd.
      void api.forgetSession(workspaceId, sessionToForget)
    }
  }

  const run = async () => {
    if (!args.trim() || running)
      return
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setError(null)
    setRunning(true)
    const promptToSend = args
    setArgs('')
    try {
      await runSkillStream({
        url: api.skillRunUrl(workspaceId, skill.id),
        args: promptToSend,
        ...(sessionId ? { resumeSessionId: sessionId } : {}),
        signal: abortRef.current.signal,
        onEvent: (event) => {
          if (event.type === 'session-started')
            setSessionId(event.sessionId)
          setEvents(prev => [...prev, event])
        },
        onError: err => setError(err.message),
      })
    }
    finally {
      setRunning(false)
    }
  }

  const turnCount = events.filter(e => e.type === 'started').length
  const isFollowUp = sessionId !== null

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm text-foreground">
            /
            {skill.frontmatter.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">{skill.frontmatter.description}</span>
        </div>
        {turnCount > 0 && (
          <Button variant="ghost" size="sm" onClick={reset} disabled={running}>
            <Plus />
            New Conversation
          </Button>
        )}
      </div>
      <SkillTranscript events={events} error={error} running={running} />
      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
        <Input
          placeholder={
            isFollowUp
              ? 'Ask a follow-up…'
              : (skill.frontmatter.argumentHint ?? 'args…')
          }
          value={args}
          onChange={e => setArgs(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !running)
              run()
          }}
          disabled={running}
          className="flex-1 font-mono"
          autoFocus
        />
        <Button size="sm" onClick={run} disabled={running || !args.trim()}>
          <Play />
          {running ? 'Running…' : isFollowUp ? 'Send' : 'Run'}
        </Button>
      </div>
    </div>
  )
}
