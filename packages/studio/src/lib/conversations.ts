import type { RunRecord, SessionMetadata } from '@braidhq/schema'

/**
 * One conversation, which is every run recorded under a single session.
 *
 * A run that errored before the agent reported a session has none to join,
 * so it stands alone under its own run id,
 * and the surfaces render it as a conversation of one.
 */
export interface SessionGroup {
  /** Stable id for selection: real sessionId when present, otherwise the runId. */
  groupId: string
  sessionId: string | null
  records: RunRecord[]
  firstPrompt: string
  skillId: string
  lastStartedAt: string
  /** Reviewer-set title via SessionMetadata, null falls back to firstPrompt. */
  title: string | null
  /**
   * Who opened the conversation, taken from its first run.
   * Null on runs recorded before attribution existed,
   * and on any run with no caller behind it.
   */
  startedBy: string | null
}

export function groupBySession(
  records: readonly RunRecord[],
  sessionTitles: readonly SessionMetadata[] = [],
): SessionGroup[] {
  const titleMap = new Map<string, string | null>(sessionTitles.map(m => [m.sessionId, m.title]))
  const groups = new Map<string, SessionGroup>()
  const orphans: SessionGroup[] = []
  // Records arrive newest-first from the API.
  // We want oldest-first inside a session,
  // so the replay reads top-to-bottom in chronological order.
  for (const record of [...records].reverse()) {
    if (!record.sessionId) {
      orphans.push({
        groupId: record.runId,
        sessionId: null,
        records: [record],
        firstPrompt: record.args,
        skillId: record.skillId,
        lastStartedAt: record.startedAt,
        title: null,
        startedBy: record.startedBy ?? null,
      })
      continue
    }
    const existingGroup = groups.get(record.sessionId)
    if (existingGroup) {
      existingGroup.records.push(record)
      existingGroup.lastStartedAt = record.startedAt
    }
    else {
      groups.set(record.sessionId, {
        groupId: record.sessionId,
        sessionId: record.sessionId,
        records: [record],
        firstPrompt: record.args,
        skillId: record.skillId,
        lastStartedAt: record.startedAt,
        title: titleMap.get(record.sessionId) ?? null,
        startedBy: record.startedBy ?? null,
      })
    }
  }
  return [...groups.values(), ...orphans].sort((a, b) => b.lastStartedAt.localeCompare(a.lastStartedAt))
}

export function formatTimestamp(value: string): string {
  // ISO 8601: `YYYY-MM-DDTHH:mm` local time.
  // The T-separator, not a space, is the distinguishing ISO marker.
  // Seconds dropped because the sidebar is narrow.
  // Full precision lives in the run record itself.
  try {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime()))
      return value
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  }
  catch {
    return value
  }
}
