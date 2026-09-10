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
  /** Calls against Braid's own graph. */
  readonly graphQueries: number
  /**
   * Everything else the agent reached for.
   *
   * Not enumerated. Which tools an agent has, and what it calls them, belongs
   * to its binding, and naming one agent's here would leave every other
   * agent's work uncounted on a surface that is supposed to be neutral about
   * which one is running.
   */
  readonly toolCalls: number
  /** Blocks rendered so far, so progress reads as output rather than effort. */
  readonly blocks: number
}

// Braid's own gateway, which is the one name this layer is entitled to know.
const BRAID_TOOL_PREFIX = 'mcp__braid-core__'

// A render call is already counted as a block, so counting it again here
// would report the same output twice.
function classify(tool: string): 'graph' | 'render' | 'tool' {
  if (!tool.startsWith(BRAID_TOOL_PREFIX))
    return 'tool'
  return tool.includes('__show_') ? 'render' : 'graph'
}

export function summariseActivity(events: readonly SkillEvent[]): RunActivity {
  let narration: string | null = null
  let graphQueries = 0
  let toolCalls = 0
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
      else if (kind === 'tool')
        toolCalls++
    }
    else if (event.type === 'block') {
      blocks++
    }
  }

  return { narration, graphQueries, toolCalls, blocks }
}
