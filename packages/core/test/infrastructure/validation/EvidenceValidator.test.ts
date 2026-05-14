import type { ModelSnapshot, NodeId, NodeStatus, NodeTypeId, SkillId } from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { EvidenceValidator } from '../../../src/infrastructure/validation/EvidenceValidator.js'

const draft = 'draft' as NodeStatus
const completed = 'completed' as NodeStatus
const aggregate = 'aggregate' as NodeTypeId

function snapshot(nodes: ModelSnapshot['nodes'], edges: ModelSnapshot['edges'] = []): ModelSnapshot {
  return { nodes, edges }
}

describe('EvidenceValidator', () => {
  const validator = new EvidenceValidator()

  it('emits error when node has no sources and no missing-evidence flag', async () => {
    const issues = await validator.validate(snapshot([
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

  it('accepts node with implementationMissing flag', async () => {
    const issues = await validator.validate(snapshot([
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

  it('accepts node with intentMissing flag', async () => {
    const issues = await validator.validate(snapshot([
      {
        id: 'n1' as NodeId,
        type: aggregate,
        name: 'Cart',
        status: completed,
        metadata: {
          sourceReferences: [{
            sourceId: 'code-a' as never,
            location: { uri: 'apps/api/cart.ts' as never },
            lastTouchedBy: 'telos-extract' as SkillId,
          }],
          intentMissing: true,
        },
      },
    ]))
    expect(issues).toEqual([])
  })

  it('rejects status=completed with no sources', async () => {
    const issues = await validator.validate(snapshot([
      {
        id: 'n1' as NodeId,
        type: aggregate,
        name: 'Cart',
        status: completed,
        metadata: { sourceReferences: [], implementationMissing: true },
      },
    ]))
    // both rules fire? no: implementationMissing satisfies first rule, but
    // completed-with-no-source still fires.
    expect(issues.map(i => i.code)).toEqual(['evidence.completed-no-source'])
  })

  it('multiple bad nodes produce multiple issues', async () => {
    const issues = await validator.validate(snapshot([
      { id: 'a' as NodeId, type: aggregate, name: 'A', status: draft, metadata: { sourceReferences: [] } },
      { id: 'b' as NodeId, type: aggregate, name: 'B', status: draft, metadata: { sourceReferences: [] } },
    ]))
    expect(issues).toHaveLength(2)
    expect(issues.map(i => i.nodeId).sort()).toEqual(['a', 'b'])
  })
})
