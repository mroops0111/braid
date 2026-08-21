import { z } from 'zod'

/**
 * A dotted path into a parsed object,
 * so a reply can be read without the loader knowing the server's shape.
 * One segment is the common case.
 */
export const ValuePath = z.string().min(1)

/**
 * Per-source config for the MCP loader.
 *
 * Every field below `url` and `headers` has a default,
 * and those defaults together describe one envelope,
 * which a gateway can be configured to emit.
 * Point this at a server shaped that way and the config is a URL.
 * Point it at a server you do not control and override the names it uses instead.
 *
 * Each group carries one rule, which is why none of the keys need a suffix.
 * `arguments` names arguments the tool takes,
 * `response` names keys in the reply,
 * and `item` names keys on one item of that reply.
 */
export const McpLoaderConfig = z.object({
  /**
   * Streamable HTTP endpoint of the MCP server.
   * Supports `${VAR}` interpolation against the server's process env.
   */
  url: z.string().min(1),
  /**
   * Sent on every request, which is where an upstream credential belongs.
   * Values support the same `${VAR}` interpolation,
   * so no token is written into the workspace manifest.
   */
  headers: z.record(z.string(), z.string()).default({}),
  /** Tool that returns one page of items. */
  tool: z.string().min(1).default('list_items'),
  arguments: z.object({
    /** Carries the high-water mark, so a later sync asks only for changes. */
    since: z.string().min(1).default('since'),
    /** Carries the previous page's cursor. */
    cursor: z.string().min(1).default('cursor'),
    /** Carries the page size. */
    limit: z.string().min(1).default('limit'),
  }).prefault({}),
  /** How many items to ask for per call. */
  limit: z.number().int().positive().max(1000).default(100),
  /**
   * A server that always answers with a cursor would otherwise be walked forever,
   * so a sync stops here and says so.
   */
  maxPages: z.number().int().positive().max(10_000).default(200),
  response: z.object({
    /** Where the page's items live. */
    items: ValuePath.default('items'),
    /** Where the next page's cursor lives. Absent or empty ends the walk. */
    cursor: ValuePath.default('nextCursor'),
  }).prefault({}),
  item: z.object({
    /** Becomes the filename, so it has to be stable across syncs. */
    id: ValuePath.default('id'),
    title: ValuePath.default('title'),
    /** Becomes the document body. */
    body: ValuePath.default('body'),
    /** Drives the high-water mark, and has to sort lexicographically. */
    updatedAt: ValuePath.default('updatedAt'),
  }).prefault({}),
})

export type McpLoaderConfig = z.infer<typeof McpLoaderConfig>

/**
 * Resolve `${VAR}` against the server's process env,
 * the same shape `source-loader-git` accepts in a remote URL.
 */
export function interpolateEnv(input: string, environment: Record<string, string | undefined>): string {
  return input.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name: string) => {
    const value = environment[name]
    if (value === undefined)
      throw new Error(`mcpLoader: environment variable "${name}" is referenced but not set`)
    return value
  })
}

/** Read a dotted path, yielding `undefined` at the first missing step. */
export function readPath(source: unknown, path: string): unknown {
  let current = source
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object')
      return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
