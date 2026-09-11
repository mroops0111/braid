import type { BlockRef, NodeId, SourceId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { graphCitations, refsOf } from '../../../src/index.js'

const reference = { sourceId: 'spec' as SourceId, location: { uri: 'a/b.md', startLine: 1 } }

function fromGraph(nodeId: string): BlockRef {
  return { provenance: 'graph', nodeId: nodeId as NodeId, reference }
}

const ownReading: BlockRef = { provenance: 'agent', reference }

describe('refsOf', () => {
  it('reaches the refs a finding keeps on each side', () => {
    const refs = refsOf({
      call: 'showFinding',
      audiences: [],
      statement: 'They disagree.',
      verdict: 'conflict',
      registered: false,
      sides: [
        { summary: 'One.', refs: [fromGraph('n-1')] },
        { summary: 'Two.', refs: [fromGraph('n-2')] },
      ],
    })
    expect(refs.map(ref => ref.nodeId)).toEqual(['n-1', 'n-2'])
  })

  it('reaches the refs a matrix keeps on each cell', () => {
    const refs = refsOf({
      call: 'showMatrix',
      audiences: [],
      rowAxis: { label: 'Plan', items: [{ id: 'r', label: 'Free' }] },
      columnAxis: { label: 'Action', items: [{ id: 'c', label: 'Sign' }] },
      cells: [{ row: 'r', column: 'c', state: 'holds', tone: 'affirmed', refs: [fromGraph('n-3')] }],
    })
    expect(refs.map(ref => ref.nodeId)).toEqual(['n-3'])
  })

  // Prose rests on the blocks around it rather than citing anything itself.
  it('finds nothing on a block that carries no references', () => {
    expect(refsOf({ call: 'showAnswer', audiences: [], markdown: 'hello' })).toEqual([])
  })
})

describe('graphCitations', () => {
  it('leaves out what the run read for itself', () => {
    const citations = graphCitations({ call: 'showEvidence', audiences: [], refs: [ownReading, fromGraph('n-1')] })
    expect(citations).toEqual([{ nodeId: 'n-1', describedAs: 'n-1' }])
  })

  // The claim is made either way,
  // so withholding the id cannot be the way out of having it checked.
  it('keeps a graph ref that names no node, under the location it does carry', () => {
    const citations = graphCitations({
      call: 'showEvidence',
      audiences: [],
      refs: [{ provenance: 'graph', reference }],
    })
    expect(citations).toEqual([{ describedAs: 'spec/a/b.md' }])
  })
})
