import type { AbsolutePath, SourceId, WorkspaceId } from '@braidhq/schema'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createMcpLoader } from '../src/McpSourceLoaderPlugin.js'

const context = { workspaceId: 'ws' as WorkspaceId, sourceId: 'issues' as SourceId }

/**
 * The rest of the suite scripts the replies, which never runs the transport.
 * This one stands up a real MCP server and lets the loader reach it,
 * so the session handshake, the streamable HTTP framing,
 * and the envelope all have to agree.
 */
describe('against a real mcp server', () => {
  const items = Array.from({ length: 7 }, (_unused, index) => ({
    id: `ISSUE-${index + 1}`,
    title: `Item ${index + 1}`,
    body: `Body of item ${index + 1}.`,
    updatedAt: `2026-01-0${index + 1}T00:00:00Z`,
    state: index % 2 === 0 ? 'open' : 'closed',
  }))

  let url: string
  let server: ReturnType<typeof serve>
  let handler: ReturnType<typeof createMcpHandler>
  let destination: string
  const argumentsSeen: Record<string, unknown>[] = []

  beforeAll(async () => {
    handler = createMcpHandler(() => {
      const mcp = new McpServer({ name: 'fixture', version: '1.0.0' })
      mcp.registerTool('list_items', {
        description: 'One page of items.',
        inputSchema: {
          since: z.string().optional(),
          cursor: z.string().optional(),
          limit: z.number().optional(),
        },
      }, (args) => {
        argumentsSeen.push(args)
        const start = args.cursor ? Number(args.cursor) : 0
        const size = 3
        const after = args.since
          ? items.filter(item => item.updatedAt > (args.since as string))
          : items
        const slice = after.slice(start, start + size)
        const next = start + size < after.length ? String(start + size) : ''
        const payload = { items: slice, nextCursor: next }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      })
      return mcp
    })
    server = serve({ fetch: handler.fetch as never, port: 0 })
    const address = server.address() as AddressInfo
    url = `http://127.0.0.1:${address.port}/`
  })

  beforeEach(async () => {
    destination = await mkdtemp(join(tmpdir(), 'braid-mcp-real-'))
    argumentsSeen.length = 0
  })

  afterAll(async () => {
    await handler.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(destination, { recursive: true, force: true }).catch(() => {})
  })

  it('mirrors every page over the wire, then asks only for what is newer', async () => {
    const loader = createMcpLoader()
    const config = { url }

    const provisioned = await loader.provision(config, destination as AbsolutePath, context)

    const visible = (await readdir(destination)).filter(name => !name.startsWith('.')).sort()
    expect(visible).toHaveLength(items.length)
    // Three pages of three, three, and one.
    expect(argumentsSeen.map(seen => seen.cursor)).toEqual([undefined, '3', '6'])
    expect(provisioned.revision).toBe('2026-01-07T00:00:00Z')
    expect(await readFile(join(destination, 'ISSUE-4.md'), 'utf-8'))
      .toContain('title: Item 4')

    argumentsSeen.length = 0
    const synced = await loader.sync!(config, destination as AbsolutePath, context)

    expect(argumentsSeen[0]?.since).toBe('2026-01-07T00:00:00Z')
    expect(synced).toMatchObject({ changed: false, added: 0 })
  })

  it('raises the server\'s message when the tool reports a failure', async () => {
    const loader = createMcpLoader()

    await expect(loader.provision(
      { url, tool: 'absent_tool' },
      destination as AbsolutePath,
      context,
    )).rejects.toThrow(/absent_tool/)
  })
})
