import type { McpSession } from './client.js'
import type { McpLoaderConfig } from './config.js'
import type { MirroredItem } from './item.js'
import { assertNotError, payloadOf } from './client.js'
import { readPath } from './config.js'
import { renderItem } from './item.js'

export interface WalkResult {
  readonly items: readonly MirroredItem[]
  /** The newest `updatedAt` seen, which becomes the next sync's floor. */
  readonly highWaterMark: string
  /** Set when the page ceiling stopped the walk before the server did. */
  readonly truncated: boolean
}

/**
 * Read every page the tool offers, starting after `since`.
 *
 * A gateway maps one call onto one upstream request and does not loop,
 * so walking the pages is the caller's job.
 * The walk ends when the reply carries no cursor,
 * or when a repeated cursor shows the server is not advancing.
 */
export async function walkPages(
  session: McpSession,
  config: McpLoaderConfig,
  since: string | undefined,
): Promise<WalkResult> {
  const items: MirroredItem[] = []
  const seenCursors = new Set<string>()
  let highWaterMark = since ?? ''
  let cursor: string | undefined
  let truncated = false

  for (let page = 0; page < config.maxPages; page++) {
    const args: Record<string, unknown> = { [config.arguments.limit]: config.limit }
    if (since !== undefined)
      args[config.arguments.since] = since
    if (cursor !== undefined)
      args[config.arguments.cursor] = cursor

    const result = await session.callTool(config.tool, args)
    assertNotError(result, config.tool)
    const payload = payloadOf(result)
    for (const raw of itemsOf(payload, config)) {
      const item = renderItem(raw, config)
      items.push(item)
      if (item.updatedAt > highWaterMark)
        highWaterMark = item.updatedAt
    }

    const next = readPath(payload, config.response.cursor)
    if (typeof next !== 'string' || next.length === 0)
      return { items, highWaterMark, truncated: false }
    // A server that keeps returning a cursor it already gave would be walked forever,
    // and the page ceiling alone would hide why.
    if (seenCursors.has(next))
      throw new Error(`mcpLoader: tool "${config.tool}" repeated cursor "${next}", so paging cannot advance`)
    seenCursors.add(next)
    cursor = next
    truncated = true
  }
  return { items, highWaterMark, truncated }
}

/**
 * The items of one page. A payload that is already an array is taken whole,
 * which is what a tool shaped to return a bare list produces.
 */
function itemsOf(payload: unknown, config: McpLoaderConfig): readonly unknown[] {
  const found = Array.isArray(payload) ? payload : readPath(payload, config.response.items)
  if (found === undefined)
    throw new Error(`mcpLoader: reply has no items at "${config.response.items}"`)
  if (!Array.isArray(found))
    throw new TypeError(`mcpLoader: "${config.response.items}" is ${typeof found}, expected an array`)
  return found
}
