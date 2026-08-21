import type { ConnectFn, McpSession, McpToolResult } from '../../src/client.js'

export interface RecordedCall {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

export interface FakeServer {
  readonly connect: ConnectFn
  readonly calls: RecordedCall[]
  /** How many sessions were opened and then closed, so a leak is visible. */
  closed: number
  readonly headersSeen: Record<string, string>[]
}

/**
 * Answers each call with the next scripted reply.
 * Scripting the replies rather than a server keeps the paging, cursor,
 * and error paths reachable without one.
 */
export function fakeServer(replies: readonly McpToolResult[]): FakeServer {
  const remaining = [...replies]
  const server: FakeServer = {
    calls: [],
    closed: 0,
    headersSeen: [],
    connect: async (_url, headers) => {
      server.headersSeen.push(headers)
      const session: McpSession = {
        callTool: async (name, args) => {
          server.calls.push({ name, arguments: args })
          const reply = remaining.shift()
          if (!reply)
            throw new Error('fakeServer: called more times than scripted')
          return reply
        },
        close: async () => {
          server.closed++
        },
      }
      return session
    },
  }
  return server
}

/** A reply shaped the way the loader's defaults expect. */
export function page(items: readonly unknown[], nextCursor?: string): McpToolResult {
  return { structuredContent: { items, ...(nextCursor ? { nextCursor } : {}) } }
}
