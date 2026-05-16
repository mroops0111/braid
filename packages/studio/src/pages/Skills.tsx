import type { SkillManifest } from '@braidhq/schema'
import { Play, Plus, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { SkillTranscript } from '@/components/SkillTranscript'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useSkills } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useConversation } from '@/lib/useRun'

export interface SkillsContinuation {
  sessionId: string
  skillId: string
  runIds: string[]
}

interface SkillsPageProps {
  workspaceId: string
  continuation?: SkillsContinuation | null
  onContinuationConsumed?: () => void
}

export function SkillsPage({ workspaceId, continuation, onContinuationConsumed }: SkillsPageProps) {
  const { data } = useSkills(workspaceId)
  const [selected, setSelected] = useState<SkillManifest | null>(null)

  // When the user clicks "Continue Conversation" from the Runs tab, swap the
  // selected skill to the one in the continuation payload and pre-populate
  // the conversation slot with the historic turn ids; the store will fetch
  // each run's events via its persistent JSONL log.
  useEffect(() => {
    if (!continuation || !data)
      return
    const match = data.items.find(m => m.id === continuation.skillId)
    if (!match)
      return
    setSelected(match)
    runStore.setTurns(workspaceId, continuation.skillId, continuation.runIds)
    onContinuationConsumed?.()
  }, [continuation, data, workspaceId, onContinuationConsumed])

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
            <SkillRunner workspaceId={workspaceId} skill={selected} />
          )
        : (
            <div className="flex-1">
              <EmptyState
                icon={Sparkles}
                title="Pick a Skill"
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
  const conversation = useConversation(workspaceId, skill.id)
  const [args, setArgs] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const running = conversation.phase === 'streaming' || submitting
  const isFollowUp = conversation.sessionId !== null
  const turnCount = conversation.events.filter(e => e.type === 'started').length

  const reset = (): void => {
    const sessionToForget = conversation.sessionId
    runStore.clearTurns(workspaceId, skill.id)
    setArgs('')
    setLocalError(null)
    if (sessionToForget) {
      // Fire-and-forget: server reclaims the per-session cwd.
      void api.forgetSession(workspaceId, sessionToForget)
    }
  }

  const run = async (): Promise<void> => {
    if (!args.trim() || running)
      return
    const promptToSend = args
    setArgs('')
    setSubmitting(true)
    setLocalError(null)
    try {
      const { runId } = await api.startSkillRun(
        workspaceId,
        skill.id,
        promptToSend,
        conversation.sessionId ?? undefined,
      )
      runStore.pushTurn(workspaceId, skill.id, runId)
    }
    catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
    finally {
      setSubmitting(false)
    }
  }

  const transcriptError = localError ?? conversation.error ?? null

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
      <SkillTranscript events={[...conversation.events]} error={transcriptError} running={running} />
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
              void run()
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
