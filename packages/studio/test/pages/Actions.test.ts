import type { AbsolutePath, PluginId, RunRecord, SkillId, SkillManifest, SkillRunId, Timestamp, UserId, WorkspaceId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { bucketByGroup, formatTimestamp, groupBySession, originLabel } from '../../src/pages/Actions'

function skill(opts: {
  id: string
  category?: 'ask' | 'build' | 'generate'
  order?: number
  origin?: 'builtin' | 'plugin' | 'workspace' | 'extension'
  pluginId?: string
}): SkillManifest {
  return {
    id: opts.id as SkillId,
    origin: opts.origin ?? 'builtin',
    path: '/abs/SKILL.md' as AbsolutePath,
    frontmatter: {
      name: opts.id,
      description: 'desc',
      disableModelInvocation: true,
      braid: {
        requiredEnv: [],
        requiredMcpServers: [],
        allowedRoles: ['owner', 'maintainer'],
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.order !== undefined ? { order: opts.order } : {}),
      },
    },
    ...(opts.pluginId ? { pluginId: opts.pluginId as PluginId } : {}),
  } as SkillManifest
}

describe('bucketByGroup', () => {
  it('places each skill in the group derived from its category', () => {
    const buckets = bucketByGroup([
      skill({ id: 'ask-1', category: 'ask' }),
      skill({ id: 'extract', category: 'build', order: 100 }),
      skill({ id: 'doc', category: 'generate' }),
      skill({ id: 'standalone' }),
    ])
    expect(buckets.ask.map(s => s.id)).toEqual(['ask-1'])
    expect(buckets.build.map(s => s.id)).toEqual(['extract'])
    expect(buckets.generate.map(s => s.id)).toEqual(['doc'])
    expect(buckets.custom.map(s => s.id)).toEqual(['standalone'])
  })

  it('sorts the build group by numeric order so step ranks line up with the workflow', () => {
    const buckets = bucketByGroup([
      // intentionally out of order; bucketByGroup must re-sort by `order`.
      skill({ id: 'reconcile', category: 'build', order: 300 }),
      skill({ id: 'extract', category: 'build', order: 100 }),
      skill({ id: 'clarify', category: 'build', order: 200 }),
    ])
    expect(buckets.build.map(s => s.id)).toEqual(['extract', 'clarify', 'reconcile'])
  })

  it('puts build skills without an order at the end so a plugin missing order is recoverable', () => {
    const buckets = bucketByGroup([
      skill({ id: 'extract', category: 'build', order: 100 }),
      skill({ id: 'mystery', category: 'build' }), // no order
      skill({ id: 'clarify', category: 'build', order: 200 }),
    ])
    expect(buckets.build.map(s => s.id)).toEqual(['extract', 'clarify', 'mystery'])
  })

  it('treats sparse order numbering correctly so plugins can slot between built-ins', () => {
    const buckets = bucketByGroup([
      skill({ id: 'extract', category: 'build', order: 100 }),
      skill({ id: 'clarify', category: 'build', order: 200 }),
      skill({ id: 'reconcile', category: 'build', order: 300 }),
      skill({ id: 'plugin-pre-extract', category: 'build', order: 50 }),
      skill({ id: 'plugin-mid', category: 'build', order: 150 }),
    ])
    expect(buckets.build.map(s => s.id)).toEqual([
      'plugin-pre-extract',
      'extract',
      'plugin-mid',
      'clarify',
      'reconcile',
    ])
  })
})

describe('originLabel', () => {
  it('returns origin string for builtin / workspace / extension', () => {
    expect(originLabel(skill({ id: 's', origin: 'builtin' }))).toBe('builtin')
    expect(originLabel(skill({ id: 's', origin: 'workspace' }))).toBe('workspace')
    expect(originLabel(skill({ id: 's', origin: 'extension' }))).toBe('extension')
  })

  it('returns the plugin id when origin is plugin and pluginId is set', () => {
    expect(originLabel(skill({ id: 's', origin: 'plugin', pluginId: 'redoc-ddd' }))).toBe('redoc-ddd')
  })

  it('falls back to the bare "plugin" origin when pluginId is missing (defensive)', () => {
    expect(originLabel(skill({ id: 's', origin: 'plugin' }))).toBe('plugin')
  })
})

describe('formatTimestamp', () => {
  it('formats a valid ISO timestamp as YYYY-MM-DDTHH:mm in local time', () => {
    // Pin the input to UTC and assert via the formatter's local-time
    // output, not by hard-coding a result. Otherwise the test depends on
    // whichever TZ CI runs in.
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
    // API delivers newest-first; groupBySession reverses inside a session
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
