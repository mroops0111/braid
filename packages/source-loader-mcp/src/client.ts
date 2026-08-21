/** What a tool call returns, narrowed to the parts a mirror reads. */
export interface McpToolResult {
  readonly isError?: boolean
  readonly structuredContent?: unknown
  readonly content?: readonly { readonly type: string, readonly text?: string }[]
}

/** One connected session, closed by the caller when the walk is done. */
export interface McpSession {
  readonly callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>
  readonly close: () => Promise<void>
}

/**
 * Opens a session.
 * The seam exists so a test drives the loader without a server,
 * the same way the github loader takes a `fetch`.
 */
export type ConnectFn = (url: string, headers: Record<string, string>) => Promise<McpSession>

/**
 * Connect over streamable HTTP.
 *
 * The gateway is a process the operator runs,
 * so the loader speaks to it and never manages its lifetime.
 * A stdio transport would put spawning, timeouts,
 * and orphan handling inside the server for a case nobody has asked for.
 */
export const connectOverHttp: ConnectFn = async (url, headers) => {
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')
  const client = new Client({ name: 'braid-source-loader-mcp', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    ...(Object.keys(headers).length > 0 ? { requestInit: { headers } } : {}),
  })
  await client.connect(transport)
  return {
    callTool: async (name, args) => await client.callTool({ name, arguments: args }) as McpToolResult,
    close: async () => {
      await client.close()
    },
  }
}

/**
 * The payload of one reply.
 *
 * A shaped object arrives as `structuredContent`,
 * which is the path a tool built for this takes. Anything else arrives as text,
 * so the first text block is parsed instead,
 * which is how a top-level array reaches us at all.
 */
export function payloadOf(result: McpToolResult): unknown {
  if (result.structuredContent !== undefined)
    return result.structuredContent
  const text = result.content?.find(part => part.type === 'text')?.text
  if (text === undefined)
    return undefined
  try {
    return JSON.parse(text)
  }
  catch {
    throw new Error('mcpLoader: tool returned text that is not JSON')
  }
}

/**
 * A failed call arrives on its own channel with a shape the server authors,
 * never as the configured envelope, so it is read here and raised.
 * Letting it fall through would look like a page of zero items,
 * and a sync that quietly mirrors nothing is worse than one that stops.
 */
export function assertNotError(result: McpToolResult, tool: string): void {
  if (!result.isError)
    return
  const text = result.content?.find(part => part.type === 'text')?.text
  throw new Error(`mcpLoader: tool "${tool}" failed${text ? `, ${text}` : ''}`)
}
