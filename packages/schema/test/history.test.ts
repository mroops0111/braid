import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import {
  ChangeKind,
  CommitGraphStats,
  CommitKind,
  CommitMessage,
  CommitMeta,
  FileDiff,
  ModelDiffEnvelope,
  TagMeta,
} from '../src/index.js'

const sha = 'a'.repeat(40)
const author = { name: 'Ada', email: 'ada@braid.local' }

describe('CommitKind', () => {
  it('is the closed catalog of workspace-repo writes', () => {
    expect(CommitKind.options).toEqual([
      'proposal-submit',
      'proposal-apply',
      'proposal-reject',
      'clarification-submit',
      'clarification-answer',
      'clarification-apply',
      'clarification-skip',
      'config',
      'restore',
      'snapshot',
      'initial',
      'batch-archive',
    ])
  })
  it('rejects a kind outside the catalog', () => {
    expect(CommitKind.safeParse('source-sync').success).toBe(false)
  })
})

describe('CommitMessage', () => {
  const valid = { kind: 'config', subject: 'edit source', userId: 'u-1' }

  it('parses a minimal message', () => {
    expect(CommitMessage.parse(valid).kind).toBe('config')
  })
  it('rejects an empty subject', () => {
    expect(CommitMessage.safeParse({ ...valid, subject: '' }).success).toBe(false)
  })
  it('rejects a subject past 120 chars', () => {
    expect(CommitMessage.safeParse({ ...valid, subject: 'a'.repeat(121) }).success).toBe(false)
  })
})

describe('CommitGraphStats', () => {
  const zero = { nodesAdded: 0, nodesRemoved: 0, edgesAdded: 0, edgesRemoved: 0 }

  it('parses all-zero counts', () => {
    expect(CommitGraphStats.parse(zero)).toEqual(zero)
  })
  it('rejects a negative count', () => {
    expect(CommitGraphStats.safeParse({ ...zero, nodesAdded: -1 }).success).toBe(false)
  })
})

describe('CommitMeta', () => {
  const valid = {
    sha,
    workspaceId: 'ws-1',
    message: { kind: 'initial', subject: 'init', userId: 'u-1' },
    author,
    committedAt: isoTimestamp,
    parents: [],
    stats: null,
  }

  it('allows null stats, an empty commit has no graph delta', () => {
    expect(CommitMeta.parse(valid).stats).toBeNull()
  })
  it('rejects a non-hex sha', () => {
    expect(CommitMeta.safeParse({ ...valid, sha: 'xyz' }).success).toBe(false)
  })
})

describe('FileDiff', () => {
  it('has four statuses', () => {
    expect(FileDiff.shape.status.options).toEqual(['added', 'updated', 'removed', 'renamed'])
  })
  it('carries previousPath for a rename', () => {
    const diff = FileDiff.parse({ path: 'b.md', status: 'renamed', previousPath: 'a.md' })
    expect(diff.previousPath).toBe('a.md')
  })
})

describe('ChangeKind', () => {
  it('has three states', () => {
    expect(ChangeKind.options).toEqual(['added', 'updated', 'removed'])
  })
})

describe('ModelDiffEnvelope', () => {
  const valid = {
    from: sha,
    to: 'b'.repeat(40),
    snapshot: { nodes: [], edges: [] },
    removed: { nodes: [], edges: [] },
    changes: { nodes: { 'n-1': 'added' }, edges: {} },
  }

  it('keys change kinds by entity id', () => {
    expect(ModelDiffEnvelope.parse(valid).changes.nodes['n-1']).toBe('added')
  })
  it('rejects an unknown change kind', () => {
    const bad = { ...valid, changes: { nodes: { 'n-1': 'moved' }, edges: {} } }
    expect(ModelDiffEnvelope.safeParse(bad).success).toBe(false)
  })
})

describe('TagMeta', () => {
  it('parses a baseline tag', () => {
    const tag = TagMeta.parse({ name: 'batch-baseline', sha, createdAt: isoTimestamp })
    expect(tag.name).toBe('batch-baseline')
  })
  it('rejects an empty name', () => {
    expect(TagMeta.safeParse({ name: '', sha, createdAt: isoTimestamp }).success).toBe(false)
  })
})
