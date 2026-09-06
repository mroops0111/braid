import type { BlockId, SkillEvent } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { summariseActivity } from '@/lib/blocks/runActivity'

function call(tool: string): SkillEvent {
  return { type: 'tool-call', tool, args: null }
}

describe('summariseActivity', () => {
  it('separates graph queries from source reads', () => {
    const activity = summariseActivity([
      call('mcp__braid-core__list_nodes'),
      call('mcp__braid-core__get_node_scope'),
      call('Bash'),
      call('Read'),
      call('Grep'),
    ])

    expect(activity.graphQueries).toBe(2)
    expect(activity.sourceReads).toBe(3)
  })

  it('does not count a render call as work done looking things up', () => {
    const activity = summariseActivity([call('mcp__braid-core__show_finding')])

    expect(activity.graphQueries).toBe(0)
    expect(activity.otherCalls).toBe(1)
  })

  it('keeps the agent\'s latest narration and ignores plumbing', () => {
    const activity = summariseActivity([
      { type: 'message', text: 'Searching the graph.' },
      { type: 'message', text: '[stderr] some warning' },
      { type: 'message', text: 'I have enough to answer.' },
    ])

    expect(activity.narration).toBe('I have enough to answer.')
  })

  it('counts blocks already rendered, so progress reads as output', () => {
    const activity = summariseActivity([
      { type: 'block', id: 'b1' as BlockId, block: { call: 'showAnswer', audiences: [], markdown: 'x' } },
    ])

    expect(activity.blocks).toBe(1)
  })

  it('reports nothing for a run that has not spoken yet', () => {
    expect(summariseActivity([])).toEqual({
      narration: null,
      graphQueries: 0,
      sourceReads: 0,
      otherCalls: 0,
      blocks: 0,
    })
  })
})
