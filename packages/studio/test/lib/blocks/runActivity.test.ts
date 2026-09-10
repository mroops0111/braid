import type { BlockId, SkillEvent } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { summariseActivity } from '@/lib/blocks/runActivity'

function call(tool: string): SkillEvent {
  return { type: 'tool-call', tool, args: null }
}

describe('summariseActivity', () => {
  // Braid's own gateway is the one name this layer knows. What an agent calls
  // its own tools is its binding's business, so anything else is counted
  // without being named, and a second agent's work is counted the same.
  it('separates calls against the graph from everything else the agent reached for', () => {
    const activity = summariseActivity([
      call('mcp__braid-core__list_nodes'),
      call('mcp__braid-core__get_node_scope'),
      call('Bash'),
      call('Read'),
      call('some_other_agents_tool'),
    ])

    expect(activity.graphQueries).toBe(2)
    expect(activity.toolCalls).toBe(3)
  })

  // A render call is already counted as a block, and counting it here too
  // would report the same output twice.
  it('counts a render call as neither', () => {
    const activity = summariseActivity([call('mcp__braid-core__show_finding')])

    expect(activity.graphQueries).toBe(0)
    expect(activity.toolCalls).toBe(0)
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
      toolCalls: 0,
      blocks: 0,
    })
  })
})
