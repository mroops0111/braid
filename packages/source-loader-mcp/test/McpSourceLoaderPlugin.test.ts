import type { AbsolutePath, SourceId, WorkspaceId } from '@braidhq/schema'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpLoader } from '../src/McpSourceLoaderPlugin.js'
import { fakeServer, page } from './fakes/fakeMcpServer.js'

const context = {
  workspaceId: 'ws' as WorkspaceId,
  sourceId: 'issues' as SourceId,
}

describe('mcp source loader', () => {
  let destination: string

  beforeEach(async () => {
    destination = await mkdtemp(join(tmpdir(), 'braid-mcp-loader-'))
  })

  afterEach(async () => {
    delete process.env.BRAID_MCP_TEST_TOKEN
    await rm(destination, { recursive: true, force: true }).catch(() => {})
  })

  const visibleFiles = async (): Promise<string[]> =>
    (await readdir(destination)).filter(name => !name.startsWith('.')).sort()

  it('writes one document per item, from a config that names only a url', async () => {
    const server = fakeServer([
      page([{ id: 7, title: 'Sign the envelope', body: 'A body.', updatedAt: '2026-01-02T00:00:00Z' }]),
    ])
    const loader = createMcpLoader({ connect: server.connect })

    const report = await loader.provision(
      { url: 'https://gateway.internal/mcp' },
      destination as AbsolutePath,
      context,
    )

    expect(await visibleFiles()).toEqual(['7.md'])
    expect(await readFile(join(destination, '7.md'), 'utf-8')).toBe(
      '---\nid: "7"\ntitle: Sign the envelope\nupdatedAt: 2026-01-02T00:00:00Z\n---\n\nA body.\n',
    )
    expect(report.revision).toBe('2026-01-02T00:00:00Z')
  })

  it('carries the item\'s other scalars into frontmatter, unasked', async () => {
    const server = fakeServer([
      page([{ id: 1, title: 'T', body: '', updatedAt: '2026-01-01T00:00:00Z', status: 'closed', assignee: 'ana' }]),
    ])
    const loader = createMcpLoader({ connect: server.connect })

    await loader.provision({ url: 'https://gateway.internal/mcp' }, destination as AbsolutePath, context)

    const written = await readFile(join(destination, '1.md'), 'utf-8')
    expect(written).toContain('assignee: ana')
    expect(written).toContain('status: closed')
  })

  it('walks every page the server offers', async () => {
    const server = fakeServer([
      page([{ id: 1, updatedAt: '2026-01-01T00:00:00Z' }], 'c1'),
      page([{ id: 2, updatedAt: '2026-01-03T00:00:00Z' }], 'c2'),
      page([{ id: 3, updatedAt: '2026-01-02T00:00:00Z' }]),
    ])
    const loader = createMcpLoader({ connect: server.connect })

    const report = await loader.provision(
      { url: 'https://gateway.internal/mcp' },
      destination as AbsolutePath,
      context,
    )

    expect(await visibleFiles()).toEqual(['1.md', '2.md', '3.md'])
    expect(server.calls.map(call => call.arguments.cursor)).toEqual([undefined, 'c1', 'c2'])
    // The mark is the newest seen, not the last page's.
    expect(report.revision).toBe('2026-01-03T00:00:00Z')
    expect(server.closed).toBe(1)
  })

  it('asks only for what changed on a later sync', async () => {
    const first = fakeServer([page([{ id: 1, updatedAt: '2026-01-01T00:00:00Z' }])])
    await createMcpLoader({ connect: first.connect })
      .provision({ url: 'https://gateway.internal/mcp' }, destination as AbsolutePath, context)

    const second = fakeServer([page([{ id: 2, updatedAt: '2026-02-01T00:00:00Z' }])])
    const report = await createMcpLoader({ connect: second.connect })
      .sync!({ url: 'https://gateway.internal/mcp' }, destination as AbsolutePath, context)

    expect(second.calls[0]?.arguments.since).toBe('2026-01-01T00:00:00Z')
    expect(report).toMatchObject({ changed: true, added: 1, updated: 0 })
  })

  it('rereads from the start when the source is pointed somewhere else', async () => {
    const first = fakeServer([page([{ id: 1, updatedAt: '2026-01-01T00:00:00Z' }])])
    await createMcpLoader({ connect: first.connect })
      .provision({ url: 'https://gateway.internal/mcp' }, destination as AbsolutePath, context)

    const second = fakeServer([page([{ id: 1, updatedAt: '2026-01-01T00:00:00Z' }])])
    await createMcpLoader({ connect: second.connect })
      .sync!({ url: 'https://elsewhere.internal/mcp' }, destination as AbsolutePath, context)

    expect(second.calls[0]?.arguments.since).toBeUndefined()
  })

  it('leaves an unchanged item byte-identical, so fingerprints do not churn', async () => {
    const item = { id: 1, title: 'T', body: 'B', updatedAt: '2026-01-01T00:00:00Z' }
    const first = fakeServer([page([item])])
    await createMcpLoader({ connect: first.connect })
      .provision({ url: 'https://gateway.internal/mcp' }, destination as AbsolutePath, context)
    const before = await readFile(join(destination, '1.md'), 'utf-8')

    const second = fakeServer([page([item])])
    const report = await createMcpLoader({ connect: second.connect })
      .sync!({ url: 'https://gateway.internal/mcp' }, destination as AbsolutePath, context)

    expect(await readFile(join(destination, '1.md'), 'utf-8')).toBe(before)
    expect(report).toMatchObject({ changed: false, added: 0, updated: 0, unchanged: 1 })
  })

  it('reads a server that names its parts differently', async () => {
    const server = fakeServer([{
      structuredContent: {
        data: { records: [{ key: 'ABC-1', summary: 'Renew', description: 'Body.', touched: '2026-01-01T00:00:00Z' }] },
      },
    }])
    const loader = createMcpLoader({ connect: server.connect })

    await loader.provision({
      url: 'https://jira.internal/mcp',
      tool: 'search_issues',
      response: { items: 'data.records', cursor: 'data.next' },
      item: { id: 'key', title: 'summary', body: 'description', updatedAt: 'touched' },
    }, destination as AbsolutePath, context)

    expect(server.calls[0]?.name).toBe('search_issues')
    expect(await visibleFiles()).toEqual(['ABC-1.md'])
    // The canonical names hold whatever the server called them.
    expect(await readFile(join(destination, 'ABC-1.md'), 'utf-8')).toContain('title: Renew')
  })

  it('resolves a credential from the environment, never from the manifest', async () => {
    const server = fakeServer([page([])])
    const loader = createMcpLoader({ connect: server.connect })
    process.env.BRAID_MCP_TEST_TOKEN = 'secret-value'

    await loader.provision({
      url: 'https://gateway.internal/mcp',
      // eslint-disable-next-line no-template-curly-in-string -- intentional: testing literal ${VAR} interpolation
      headers: { Authorization: 'Bearer ${BRAID_MCP_TEST_TOKEN}' },
    }, destination as AbsolutePath, context)

    expect(server.headersSeen[0]).toEqual({ Authorization: 'Bearer secret-value' })
  })

  it('names the variable when it is not set', async () => {
    const loader = createMcpLoader({ connect: fakeServer([]).connect })
    delete process.env.BRAID_MCP_ABSENT_TOKEN

    await expect(loader.provision({
      url: 'https://gateway.internal/mcp',
      // eslint-disable-next-line no-template-curly-in-string -- intentional: testing literal ${VAR} interpolation
      headers: { Authorization: 'Bearer ${BRAID_MCP_ABSENT_TOKEN}' },
    }, destination as AbsolutePath, context)).rejects.toThrow(/BRAID_MCP_ABSENT_TOKEN/)
  })

  it('fails the sync on a tool error, rather than mirroring nothing', async () => {
    const server = fakeServer([
      { isError: true, content: [{ type: 'text', text: 'upstream returned 502' }] },
    ])
    const loader = createMcpLoader({ connect: server.connect })

    await expect(loader.provision(
      { url: 'https://gateway.internal/mcp' },
      destination as AbsolutePath,
      context,
    )).rejects.toThrow(/upstream returned 502/)
  })

  // A real gateway puts the upstream error body in `structuredContent` as well,
  // which is where a payload would be read from.
  // Reading the failure first is what keeps the cause visible,
  // instead of a complaint that the envelope has no items.
  it('reports the failure, not the envelope, when the error carries a body', async () => {
    const server = fakeServer([{
      isError: true,
      content: [{ type: 'text', text: 'Upstream GET returned 401 Unauthorized' }],
      structuredContent: { message: 'Bad credentials', status: '401' },
    }])
    const loader = createMcpLoader({ connect: server.connect })

    await expect(loader.provision(
      { url: 'https://gateway.internal/mcp' },
      destination as AbsolutePath,
      context,
    )).rejects.toThrow(/401 Unauthorized/)
  })

  it('stops at the page ceiling and says so', async () => {
    const endless = Array.from({ length: 5 }, (_unused, index) =>
      page([{ id: index, updatedAt: '2026-01-01T00:00:00Z' }], `cursor-${index}`))
    const server = fakeServer(endless)
    const loader = createMcpLoader({ connect: server.connect })

    const report = await loader.provision({
      url: 'https://gateway.internal/mcp',
      maxPages: 3,
    }, destination as AbsolutePath, context)

    expect(server.calls).toHaveLength(3)
    expect(report.metadata).toMatchObject({ truncated: true })
  })

  it('refuses a server that keeps handing back the same cursor', async () => {
    const server = fakeServer([
      page([{ id: 1, updatedAt: '2026-01-01T00:00:00Z' }], 'stuck'),
      page([{ id: 2, updatedAt: '2026-01-01T00:00:00Z' }], 'stuck'),
    ])
    const loader = createMcpLoader({ connect: server.connect })

    await expect(loader.provision(
      { url: 'https://gateway.internal/mcp' },
      destination as AbsolutePath,
      context,
    )).rejects.toThrow(/repeated cursor/)
  })

  it('closes the session even when the walk throws', async () => {
    const server = fakeServer([{ isError: true, content: [{ type: 'text', text: 'nope' }] }])
    const loader = createMcpLoader({ connect: server.connect })

    await expect(loader.provision(
      { url: 'https://gateway.internal/mcp' },
      destination as AbsolutePath,
      context,
    )).rejects.toThrow()
    expect(server.closed).toBe(1)
  })

  it('keeps its cursor out of the documents it mirrors', async () => {
    const server = fakeServer([page([{ id: 1, updatedAt: '2026-01-01T00:00:00Z' }])])
    const loader = createMcpLoader({ connect: server.connect })

    await loader.provision({ url: 'https://gateway.internal/mcp' }, destination as AbsolutePath, context)

    expect(await readdir(destination)).toContain('.braid-mcp-cursor.json')
    expect(await visibleFiles()).toEqual(['1.md'])
  })
})
