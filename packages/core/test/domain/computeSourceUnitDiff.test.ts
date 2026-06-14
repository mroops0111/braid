import type { SkillRunId, SourceId, SourceUnit, SourceUnitSha, SourceUnitState, Timestamp, WorkspaceId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { computeSourceUnitDiff } from '../../src/index.js'

function sha(byte: string): SourceUnitSha {
  return byte.repeat(64) as SourceUnitSha
}

function state(path: string, byte: string): SourceUnitState {
  return {
    workspaceId: 'ws-1' as WorkspaceId,
    sourceId: 'src-1' as SourceId,
    path,
    lastObservedSha: sha(byte),
    lastObservedAt: '2026-06-08T00:00:00.000Z' as Timestamp,
    lastObservedByRunId: 'run-1' as SkillRunId,
  }
}

function unit(path: string, byte: string): SourceUnit {
  return { sourceId: 'src-1' as SourceId, path, sha: sha(byte) }
}

describe('computeSourceUnitDiff', () => {
  it('partitions units into new / changed / unchanged / orphaned', () => {
    const result = computeSourceUnitDiff(
      [
        state('done.md', '1'),
        state('changed.md', '2'),
        state('orphaned.md', '3'),
      ],
      [
        unit('done.md', '1'),
        unit('changed.md', 'a'),
        unit('new.md', 'b'),
      ],
    )

    expect(result.unchanged.map(u => u.path)).toEqual(['done.md'])
    expect(result.changed.map(u => u.path)).toEqual(['changed.md'])
    expect(result.new.map(u => u.path)).toEqual(['new.md'])
    expect(result.orphaned.map(s => s.path)).toEqual(['orphaned.md'])
  })

  it('empty inputs return empty partitions', () => {
    const result = computeSourceUnitDiff([], [])
    expect(result).toEqual({ new: [], changed: [], unchanged: [], orphaned: [] })
  })

  it('treats units with no prior state as new', () => {
    const result = computeSourceUnitDiff([], [unit('a.md', '1'), unit('b.md', '2')])
    expect(result.new.map(u => u.path)).toEqual(['a.md', 'b.md'])
  })
})
