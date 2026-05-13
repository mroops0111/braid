import type { RunRecord, SkillEvent } from '@telos/schema'
import { History, MessagesSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { SkillTranscript } from '@/components/SkillTranscript'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { useRuns } from '@/lib/queries'
import { readSkillEventStream } from '@/lib/sse'

interface RunsPageProps {
  workspaceId: string
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

export function RunsPage({ workspaceId }: RunsPageProps) {
  const { data, isLoading } = useRuns(workspaceId)
  const [selectedGroup, setSelectedGroup] = useState<SessionGroup | null>(null)

  if (isLoading)
    return <div className="p-4 text-sm text-muted-foreground">Loading runs…</div>

  const groups = groupBySession(data?.items ?? [])
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No runs yet"
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
          ? <RunReplay workspaceId={workspaceId} group={selectedGroup} key={selectedGroup.groupId} />
          : (
              <EmptyState
                icon={MessagesSquare}
                title="Pick a conversation"
                description="Select a run on the left to replay its events here."
              />
            )}
      </div>
    </div>
  )
}

function RunReplay({ workspaceId, group }: { workspaceId: string, group: SessionGroup }) {
  const [events, setEvents] = useState<SkillEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setEvents([])
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        for (const record of group.records) {
          await readSkillEventStream({
            url: api.runEventsUrl(workspaceId, record.runId),
            signal: controller.signal,
            onEvent: event => setEvents(prev => [...prev, event]),
          })
        }
      }
      catch (err) {
        setError((err as Error).message)
      }
      finally {
        setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [workspaceId, group.groupId, group.records])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="font-mono text-sm text-foreground">
          /
          {group.skillId}
        </span>
        <span className="text-xs text-muted-foreground">
          {group.records.length}
          {' '}
          turn
          {group.records.length === 1 ? '' : 's'}
          {' '}
          •
          {' '}
          {formatTimestamp(group.lastStartedAt)}
        </span>
      </div>
      <SkillTranscript events={events} error={error} running={loading} />
    </div>
  )
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
