import type { DriftIssueId, ModelSnapshot, NodeId, NodeStatus, NodeTypeId, SourceId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { validateEvidence } from '../../../src/domain/validation/validateEvidence.js'

const draft = 'draft' as NodeStatus
const completed = 'completed' as NodeStatus
const aggregate = 'aggregate' as NodeTypeId

function sourceRef(uri: string, sourceId = 'src') {
  return { sourceId: sourceId as SourceId, location: { uri } }
}

function snapshot(nodes: ModelSnapshot['nodes'], edges: ModelSnapshot['edges'] = []): ModelSnapshot {
  return { nodes, edges }
}

describe('validateEvidence', () => {
  it('emits error when node has no sources and no missing-evidence flag', () => {
    const issues = validateEvidence(snapshot([
      {
        id: 'n1' as NodeId,
        type: aggregate,
        name: 'Cart',
        status: draft,
        metadata: { sourceReferences: [] },
      },
    ]))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      code: 'evidence.no-source-or-flag',
      severity: 'error',
      nodeId: 'n1',
    })
  })

  it('accepts node with implementationMissing flag', () => {
    const issues = validateEvidence(snapshot([
      {
        id: 'n1' as NodeId,
        type: aggregate,
        name: 'Cart',
        status: draft,
        metadata: { sourceReferences: [], implementationMissing: true },
      },
    ]))
    expect(issues).toEqual([])
  })

  it('accepts node with intentMissing flag', () => {
    const issues = validateEvidence(snapshot([
      {
        id: 'n1' as NodeId,
        type: aggregate,
        name: 'Cart',
        status: completed,
        metadata: {
          sourceReferences: [{
            sourceId: 'code-a' as SourceId,
            location: { uri: 'apps/api/cart.ts' },
          }],
          intentMissing: true,
        },
      },
    ]))
    expect(issues).toEqual([])
  })

  it('rejects status=completed with no sources', () => {
    const issues = validateEvidence(snapshot([
      {
        id: 'n1' as NodeId,
        type: aggregate,
        name: 'Cart',
        status: completed,
        metadata: { sourceReferences: [], implementationMissing: true },
      },
    ]))
    // implementationMissing clears the no-source rule,
    // but completed-no-source still fires.
    expect(issues.map(i => i.code)).toEqual(['evidence.completed-no-source'])
  })

  it('multiple bad nodes produce multiple issues', () => {
    const issues = validateEvidence(snapshot([
      { id: 'a' as NodeId, type: aggregate, name: 'A', status: draft, metadata: { sourceReferences: [] } },
      { id: 'b' as NodeId, type: aggregate, name: 'B', status: draft, metadata: { sourceReferences: [] } },
    ]))
    expect(issues).toHaveLength(2)
    expect(issues.map(i => i.nodeId).sort()).toEqual(['a', 'b'])
  })

  describe('drift surfacing', () => {
    it('emits one ValidationIssue per DriftIssue with severity preserved', () => {
      const issues = validateEvidence(snapshot([
        {
          id: 'n1' as NodeId,
          type: aggregate,
          name: 'Cart',
          status: draft,
          metadata: {
            sourceReferences: [sourceRef('intent/cart.md'), sourceRef('apps/api/cart.ts')],
            driftIssues: [
              {
                id: 'd1' as DriftIssueId,
                description: 'Intent says cap 50, code allows 99',
                severity: 'error',
                sourceReferences: [sourceRef('intent/cart.md'), sourceRef('apps/api/cart.ts')],
                raisedAt: '2026-05-23T00:00:00.000Z',
              },
              {
                id: 'd2' as DriftIssueId,
                description: 'Intent uses "shopper", code uses "customer"',
                severity: 'warning',
                sourceReferences: [sourceRef('intent/cart.md'), sourceRef('apps/api/cart.ts')],
                raisedAt: '2026-05-23T00:00:00.000Z',
              },
            ],
          },
        },
      ]))
      const drift = issues.filter(i => i.code === 'evidence.drift')
      expect(drift).toHaveLength(2)
      expect(drift.map(i => i.severity).sort()).toEqual(['error', 'warning'])
      expect(drift.every(i => i.nodeId === 'n1')).toBe(true)
      expect(drift[0]!.message).toContain('Cart')
    })

    it('suppresses drift whose description appears in acknowledgedDrifts', () => {
      const description = 'Intent uses "shopper", code uses "customer"'
      const issues = validateEvidence(snapshot([
        {
          id: 'n1' as NodeId,
          type: aggregate,
          name: 'Cart',
          status: draft,
          metadata: {
            sourceReferences: [sourceRef('intent/cart.md'), sourceRef('apps/api/cart.ts')],
            driftIssues: [
              {
                id: 'd1' as DriftIssueId,
                description,
                severity: 'warning',
                sourceReferences: [sourceRef('intent/cart.md'), sourceRef('apps/api/cart.ts')],
                raisedAt: '2026-05-23T00:00:00.000Z',
              },
            ],
            acknowledgedDrifts: [description],
          },
        },
      ]))
      expect(issues.filter(i => i.code === 'evidence.drift')).toEqual([])
    })

    it('emits nothing when driftIssues is undefined or empty', () => {
      const issues = validateEvidence(snapshot([
        {
          id: 'n1' as NodeId,
          type: aggregate,
          name: 'Cart',
          status: draft,
          metadata: {
            sourceReferences: [sourceRef('intent/cart.md')],
            driftIssues: [],
          },
        },
      ]))
      expect(issues.filter(i => i.code === 'evidence.drift')).toEqual([])
    })
  })
})
