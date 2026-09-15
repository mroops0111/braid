import type { RunRecord, SkillId, SkillRunId, Timestamp, UserId, WorkspaceId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { formatTimestamp, groupBySession } from '../../src/lib/conversations'

describe('formatTimestamp', () => {
  it('formats a valid ISO timestamp as YYYY-MM-DDTHH:mm in local time', () => {
    // Pin the input to UTC and assert via the formatter's local-time output,
    // rather than by hard-coding a result.
    // Otherwise the test depends on whichever TZ CI runs in.
    const iso = '2026-05-21T14:30:00Z'
    const d = new Date(iso)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    expect(formatTimestamp(iso)).toBe(expected)
  })

  it('returns the raw string when given junk that does not parse', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date')
  })
})

describe('groupBySession', () => {
  function rec(opts: { runId: string, sessionId?: string, args?: string, startedAt: string, skillId?: string, startedBy?: string }): RunRecord {
    return {
      runId: opts.runId as SkillRunId,
      workspaceId: 'ws' as WorkspaceId,
      skillId: (opts.skillId ?? 'braid:ask') as SkillId,
      args: opts.args ?? '',
      resumed: false,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.startedBy ? { startedBy: opts.startedBy as UserId } : {}),
      startedAt: opts.startedAt as Timestamp,
    } as RunRecord
  }

  it('takes the author from the run that opened the session', () => {
    // The later run carries no author, and must not blank the group,
    // since a resumed conversation still belongs to whoever started it.
    const groups = groupBySession([
      rec({ runId: 'r2', sessionId: 'sess-1', startedAt: '2026-05-21T10:20:00Z' }),
      rec({ runId: 'r1', sessionId: 'sess-1', startedBy: 'user-abc', startedAt: '2026-05-21T10:10:00Z' }),
    ])
    expect(groups[0]!.startedBy).toBe('user-abc')
  })

  it('leaves the author null on a run recorded before attribution existed', () => {
    const groups = groupBySession([rec({ runId: 'r1', sessionId: 'sess-1', startedAt: '2026-05-21T10:10:00Z' })])
    expect(groups[0]!.startedBy).toBeNull()
  })

  it('groups runs that share a sessionId and orders runs within a group oldest-first', () => {
    // API delivers newest-first, and groupBySession reverses inside a session,
    // so the transcript replays top-to-bottom.
    const groups = groupBySession([
      rec({ runId: 'r3', sessionId: 'sess-1', startedAt: '2026-05-21T10:30:00Z' }),
      rec({ runId: 'r2', sessionId: 'sess-1', startedAt: '2026-05-21T10:20:00Z' }),
      rec({ runId: 'r1', sessionId: 'sess-1', args: 'first', startedAt: '2026-05-21T10:10:00Z' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.records.map(r => r.runId)).toEqual(['r1', 'r2', 'r3'])
    expect(groups[0]!.firstPrompt).toBe('first')
  })

  it('orphan runs (no sessionId) each become their own group', () => {
    const groups = groupBySession([
      rec({ runId: 'r1', startedAt: '2026-05-21T10:00:00Z' }),
      rec({ runId: 'r2', startedAt: '2026-05-21T10:05:00Z' }),
    ])
    expect(groups.map(g => g.groupId).sort()).toEqual(['r1', 'r2'])
  })

  it('sorts groups newest-first by lastStartedAt across sessions and orphans', () => {
    const groups = groupBySession([
      rec({ runId: 'a', sessionId: 'old', startedAt: '2026-05-21T08:00:00Z' }),
      rec({ runId: 'b', startedAt: '2026-05-21T12:00:00Z' }), // orphan, latest
      rec({ runId: 'c', sessionId: 'mid', startedAt: '2026-05-21T10:00:00Z' }),
    ])
    expect(groups.map(g => g.groupId)).toEqual(['b', 'mid', 'old'])
  })
})
