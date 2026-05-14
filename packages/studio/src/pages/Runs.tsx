import type { RunRecord, SkillEvent } from '@telos/schema'
import { ArrowRight, History, MessagesSquare } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { SkillTranscript } from '@/components/SkillTranscript'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useRuns } from '@/lib/queries'
import { runStore } from '@/lib/runStore'

export interface ContinueRequest {
  sessionId: string
  skillId: string
  runIds: string[]
}

interface RunsPageProps {
  workspaceId: string
  onContinue: (request: ContinueRequest) => void
}

interface SessionGroup {
  /** Stable id for selection: real sessionId when present, otherwise the runId. */
  groupId: string
  sessionId: string | null
  records: RunRecord[]
  firstPrompt: string
  skillId: string
  lastStartedAt: string
}

export function RunsPage({ workspaceId, onContinue }: RunsPageProps) {
  const { data, isLoading } = useRuns(workspaceId)
  const [selectedGroup, setSelectedGroup] = useState<SessionGroup | null>(null)

  if (isLoading)
    return <div className="p-4 text-sm text-muted-foreground">Loading runs…</div>

  const groups = groupBySession(data?.items ?? [])
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No Runs Yet"
        description="Skill runs from this workspace will appear here. Open the Skills tab and run something."
      />
    )
  }

  return (
    <div className="flex h-full">
      <ul className="w-96 shrink-0 overflow-y-auto scrollbar-thin border-r border-border">
        {groups.map(group => (
          <ListRow
            key={group.groupId}
            active={selectedGroup?.groupId === group.groupId}
            onClick={() => setSelectedGroup(group)}
            className="flex-col gap-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-foreground">
                /
                {group.skillId}
              </span>
              <Badge variant="outline" className="text-[10px] uppercase">
                {group.records.length}
                {' '}
                turn
                {group.records.length === 1 ? '' : 's'}
              </Badge>
            </div>
            <div className="line-clamp-2 text-xs text-foreground/90">{group.firstPrompt}</div>
            <div className="text-[10px] text-muted-foreground">{formatTimestamp(group.lastStartedAt)}</div>
          </ListRow>
        ))}
      </ul>
      <div className="flex-1 overflow-hidden">
        {selectedGroup
          ? (
              <RunReplay
                workspaceId={workspaceId}
                group={selectedGroup}
                onContinue={onContinue}
                key={selectedGroup.groupId}
              />
            )
          : (
              <EmptyState
                icon={MessagesSquare}
                title="Pick a Conversation"
                description="Select a run on the left to replay its events here."
              />
            )}
      </div>
    </div>
  )
}

interface RunReplayProps {
  workspaceId: string
  group: SessionGroup
  onContinue: (request: ContinueRequest) => void
}

function RunReplay({ workspaceId, group, onContinue }: RunReplayProps) {
  // Hydrate every turn in this group into the central store so the SSE
  // tail keeps going even if the user switches tabs.
  useEffect(() => {
    for (const record of group.records)
      runStore.loadRun(workspaceId, record.runId, record.skillId)
  }, [workspaceId, group.records])

  // Aggregate events from all turns. Cache the snapshot so
  // useSyncExternalStore sees a stable reference when nothing changed.
  const cached = useGroupSnapshot(workspaceId, group)
  const { events, phase, error } = cached

  const canContinue = group.sessionId !== null
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm text-foreground">
            /
            {group.skillId}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {group.records.length}
            {' '}
            turn
            {group.records.length === 1 ? '' : 's'}
            {' '}
            ·
            {' '}
            {formatTimestamp(group.lastStartedAt)}
          </span>
        </div>
        {canContinue && (
          <Button
            size="sm"
            onClick={() => onContinue({
              sessionId: group.sessionId!,
              skillId: group.skillId,
              runIds: group.records.map(r => r.runId),
            })}
          >
            Continue Conversation
            <ArrowRight />
          </Button>
        )}
      </div>
      <SkillTranscript events={events} error={error ?? null} running={phase === 'streaming'} />
    </div>
  )
}

interface GroupSnapshot {
  events: SkillEvent[]
  phase: 'streaming' | 'done' | 'error' | 'idle'
  error?: string
}

function useGroupSnapshot(workspaceId: string, group: SessionGroup): GroupSnapshot {
  return useSyncExternalStore(
    cb => runStore.subscribe(cb),
    () => getGroupSnapshot(workspaceId, group),
  )
}

const groupCache = new Map<string, GroupSnapshot>()
const groupInputs = new Map<string, ReadonlyArray<unknown>>()

function getGroupSnapshot(workspaceId: string, group: SessionGroup): GroupSnapshot {
  const key = `${workspaceId}|${group.groupId}`
  const states = group.records.map(r => runStore.getRun(workspaceId, r.runId))
  const cached = groupInputs.get(key)
  if (cached && cached.length === states.length && cached.every((s, i) => s === states[i])) {
    return groupCache.get(key)!
  }
  const events: SkillEvent[] = []
  let phase: 'streaming' | 'done' | 'error' | 'idle' = 'idle'
  let error: string | undefined
  for (const state of states) {
    if (!state)
      continue
    events.push(...state.events)
    phase = state.phase
    if (state.error)
      error = state.error
  }
  const snapshot: GroupSnapshot = { events, phase, ...(error ? { error } : {}) }
  groupInputs.set(key, states)
  groupCache.set(key, snapshot)
  return snapshot
}

function groupBySession(records: readonly RunRecord[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>()
  const orphans: SessionGroup[] = []
  // records arrive newest-first from the API; we want oldest-first inside a
  // session so the replay reads top-to-bottom in chronological order.
  for (const rec of [...records].reverse()) {
    if (!rec.sessionId) {
      orphans.push({
        groupId: rec.runId,
        sessionId: null,
        records: [rec],
        firstPrompt: rec.args,
        skillId: rec.skillId,
        lastStartedAt: rec.startedAt,
      })
      continue
    }
    const existing = groups.get(rec.sessionId)
    if (existing) {
      existing.records.push(rec)
      existing.lastStartedAt = rec.startedAt
    }
    else {
      groups.set(rec.sessionId, {
        groupId: rec.sessionId,
        sessionId: rec.sessionId,
        records: [rec],
        firstPrompt: rec.args,
        skillId: rec.skillId,
        lastStartedAt: rec.startedAt,
      })
    }
  }
  const combined = [...groups.values(), ...orphans]
  return combined.sort((a, b) => b.lastStartedAt.localeCompare(a.lastStartedAt))
}

function formatTimestamp(value: string): string {
  try {
    const d = new Date(value)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  catch {
    return value
  }
}
