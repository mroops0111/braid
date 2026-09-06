import type { SkillEvent } from '@braidhq/schema'

/**
 * What a run is doing right now, reduced to what a reader can act on.
 *
 * An answer takes minutes to settle, and the blocks only start arriving near
 * the end, so without this the surface is blank for most of the run. The
 * stream carries the work the whole time, it was simply not being shown.
 */
export interface RunActivity {
  /** The agent's own last line of narration, its plainest account of itself. */
  readonly narration: string | null
  /** Queries against the graph. */
  readonly graphQueries: number
  /** Reads against the workspace's declared sources. */
  readonly sourceReads: number
  readonly otherCalls: number
  /** Blocks rendered so far, so progress reads as output rather than effort. */
  readonly blocks: number
}

const SOURCE_TOOLS = new Set(['Bash', 'Read', 'Grep', 'Glob'])

function classify(tool: string): 'graph' | 'source' | 'other' {
  if (tool.startsWith('mcp__braid-core__'))
    return tool.includes('__show_') ? 'other' : 'graph'
  return SOURCE_TOOLS.has(tool) ? 'source' : 'other'
}

export function summariseActivity(events: readonly SkillEvent[]): RunActivity {
  let narration: string | null = null
  let graphQueries = 0
  let sourceReads = 0
  let otherCalls = 0
  let blocks = 0

  for (const event of events) {
    if (event.type === 'message') {
      // `[stderr]` lines are plumbing, not the agent accounting for itself.
      const text = event.text.trim()
      if (text.length > 0 && !text.startsWith('[stderr]'))
        narration = text
    }
    else if (event.type === 'tool-call') {
      const kind = classify(event.tool)
      if (kind === 'graph')
        graphQueries++
      else if (kind === 'source')
        sourceReads++
      else
        otherCalls++
    }
    else if (event.type === 'block') {
      blocks++
    }
  }

  return { narration, graphQueries, sourceReads, otherCalls, blocks }
}
