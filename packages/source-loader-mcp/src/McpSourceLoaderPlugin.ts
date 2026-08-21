import type { SourceLoaderPlugin } from '@braidhq/core'
import type { Timestamp } from '@braidhq/schema'
import type { ConnectFn } from './client.js'
import type { McpLoaderConfig } from './config.js'
import type { MirroredItem } from './item.js'
import type { WalkResult } from './mirror.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { defineSourceLoaderPlugin } from '@braidhq/sdk'
import { connectOverHttp } from './client.js'
import { McpLoaderConfig as ConfigSchema, interpolateEnv } from './config.js'
import { walkPages } from './mirror.js'

const CURSOR_FILENAME = '.braid-mcp-cursor.json'

interface CursorFile {
  /** Identifies the config this mark belongs to, so a retarget starts over. */
  readonly url: string
  readonly tool: string
  readonly since: string
}

export interface McpLoaderDeps {
  /** Defaults to a streamable HTTP session. Replaced in tests. */
  readonly connect?: ConnectFn
  /** Defaults to the server's own environment, read for `${VAR}`. */
  readonly environment?: Record<string, string | undefined>
}

/**
 * Mirror an API-backed source into markdown, one file per item,
 * by calling one MCP tool until its pages run out.
 *
 * The loader knows a tool name and where the parts of a reply live,
 * and nothing about any product.
 * Both are configuration whose defaults describe one envelope,
 * so a gateway shaped to emit it needs only a URL here,
 * and a server that emits something else is reached by naming its shape instead.
 *
 * The destination is owned by this loader.
 * An item is written only when its rendering differs,
 * so an untouched one stays byte-identical,
 * and the fingerprints downstream do not churn.
 */
export function createMcpLoader(deps: McpLoaderDeps = {}): SourceLoaderPlugin {
  const connect = deps.connect ?? connectOverHttp
  const environment = deps.environment ?? process.env

  const mirror = async (
    config: McpLoaderConfig,
    since: string | undefined,
  ): Promise<{ url: string, walked: WalkResult }> => {
    const url = interpolateEnv(config.url, environment)
    const headers = Object.fromEntries(
      Object.entries(config.headers).map(([key, value]) => [key, interpolateEnv(value, environment)]),
    )
    const session = await connect(url, headers)
    try {
      return { url, walked: await walkPages(session, config, since) }
    }
    finally {
      await session.close()
    }
  }

  return defineSourceLoaderPlugin({
    kind: 'mcp',
    configSchema: ConfigSchema,
    provision: async (config, destination) => {
      await mkdir(destination, { recursive: true })
      // No floor on the first pass, so the corpus arrives whole.
      // Narrowing it is the tool's own business,
      // through a default on its `since`.
      const { url, walked } = await mirror(config, undefined)
      for (const item of walked.items)
        await writeIfChanged(join(destination, item.filename), item.markdown)
      if (walked.highWaterMark)
        await writeCursor(destination, { url, tool: config.tool, since: walked.highWaterMark })
      return {
        localPath: destination,
        ...(walked.highWaterMark ? { revision: walked.highWaterMark } : {}),
        metadata: { url, tool: config.tool, itemCount: walked.items.length, truncated: walked.truncated },
        fetchedAt: new Date().toISOString() as Timestamp,
      }
    },
    sync: async (config, destination) => {
      await mkdir(destination, { recursive: true })
      const previous = await readCursor(destination)
      const url = interpolateEnv(config.url, environment)
      // A mark recorded against a different target says nothing about this one,
      // so retargeting a source re-reads it whole,
      // rather than silently skipping everything older.
      const since = previous?.url === url && previous.tool === config.tool
        ? previous.since
        : undefined
      const { walked } = await mirror(config, since)
      const counts = await writeAll(destination, walked.items)
      if (walked.highWaterMark)
        await writeCursor(destination, { url, tool: config.tool, since: walked.highWaterMark })
      return {
        changed: counts.added + counts.updated > 0,
        ...counts,
        ...(walked.highWaterMark ? { revision: walked.highWaterMark } : {}),
        metadata: { url, tool: config.tool, since: since ?? null, truncated: walked.truncated },
        fetchedAt: new Date().toISOString() as Timestamp,
      }
    },
  })
}

interface WriteCounts {
  readonly added: number
  readonly updated: number
  readonly unchanged: number
}

async function writeAll(destination: string, items: readonly MirroredItem[]): Promise<WriteCounts> {
  let added = 0
  let updated = 0
  let unchanged = 0
  for (const item of items) {
    const outcome = await writeIfChanged(join(destination, item.filename), item.markdown)
    if (outcome === 'added')
      added++
    else if (outcome === 'updated')
      updated++
    else
      unchanged++
  }
  // Nothing is deleted here.
  // An item the tool stops returning may simply be older than the floor,
  // so removal needs a full re-read to be safe.
  return { added, updated, unchanged }
}

async function writeIfChanged(path: string, content: string): Promise<'added' | 'updated' | 'unchanged'> {
  let existing: string | undefined
  try {
    existing = await readFile(path, 'utf-8')
  }
  catch {
    existing = undefined
  }
  if (existing === content)
    return 'unchanged'
  await writeFile(path, content, 'utf-8')
  return existing === undefined ? 'added' : 'updated'
}

// The dotfile keeps this out of the unit listing,
// which skips names beginning with a dot.
async function readCursor(destination: string): Promise<CursorFile | undefined> {
  try {
    return JSON.parse(await readFile(join(destination, CURSOR_FILENAME), 'utf-8')) as CursorFile
  }
  catch {
    return undefined
  }
}

async function writeCursor(destination: string, cursor: CursorFile): Promise<void> {
  await writeFile(join(destination, CURSOR_FILENAME), `${JSON.stringify(cursor, null, 2)}\n`, 'utf-8')
}
