import type { McpServerId } from '@braidhq/schema'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMcpConfig, writeMcpConfigFile } from '../../../src/infrastructure/agent/mcpConfig.js'
import { makeWorkspace } from '../../helpers/fakes.js'

const BRAID_CORE_STDIO = {
  id: 'braid-core' as McpServerId,
  transport: 'stdio' as const,
  command: 'uvx',
  args: [
    'openapi-mcp-gateway',
    '--spec',
    'http://127.0.0.1:4321/openapi.json',
    '--transport',
    'stdio',
    '--name',
    'braid-core',
  ],
}

describe('buildMcpConfig', () => {
  it('emits workspace streamable-http servers as claude-cli http entries', () => {
    const workspace = makeWorkspace({
      mcpServers: [
        { id: 'jira' as McpServerId, transport: 'streamable-http', url: 'https://jira.example/mcp' },
      ],
    })
    const config = buildMcpConfig(workspace)
    expect(Object.keys(config.mcpServers)).toEqual(['jira'])
    expect(config.mcpServers.jira).toEqual({ type: 'http', url: 'https://jira.example/mcp' })
  })

  it('emits a stdio extraServers entry with command + args', () => {
    const workspace = makeWorkspace()
    const config = buildMcpConfig(workspace, { extraServers: [BRAID_CORE_STDIO] })
    expect(config.mcpServers['braid-core']).toEqual({
      type: 'stdio',
      command: 'uvx',
      args: BRAID_CORE_STDIO.args,
    })
  })

  it('merges extraServers ahead of workspace entries', () => {
    const workspace = makeWorkspace({
      mcpServers: [
        { id: 'jira' as McpServerId, transport: 'streamable-http', url: 'https://jira.example/mcp' },
      ],
    })
    const config = buildMcpConfig(workspace, { extraServers: [BRAID_CORE_STDIO] })
    expect(Object.keys(config.mcpServers).sort()).toEqual(['braid-core', 'jira'])
    expect(config.mcpServers['braid-core']).toMatchObject({ type: 'stdio', command: 'uvx' })
    expect(config.mcpServers.jira).toEqual({ type: 'http', url: 'https://jira.example/mcp' })
  })

  it('lets a workspace MCP entry override a built-in with the same id', () => {
    const workspace = makeWorkspace({
      mcpServers: [
        { id: 'braid-core' as McpServerId, transport: 'streamable-http', url: 'http://override.example/mcp' },
      ],
    })
    const config = buildMcpConfig(workspace, { extraServers: [BRAID_CORE_STDIO] })
    expect(config.mcpServers['braid-core']).toEqual({
      type: 'http',
      url: 'http://override.example/mcp',
    })
  })
})

describe('writeMcpConfigFile', () => {
  it('writes the merged config to a per-workspace file inside the target directory', async () => {
    const workspace = makeWorkspace()
    const dir = await mkdtemp(join(tmpdir(), 'braid-mcp-'))
    const written = await writeMcpConfigFile(workspace, dir, { extraServers: [BRAID_CORE_STDIO] })
    expect(written.endsWith(`.braid-mcp-${workspace.id}.json`)).toBe(true)
    const parsed = JSON.parse(await readFile(written, 'utf-8'))
    expect(parsed.mcpServers['braid-core']).toMatchObject({
      type: 'stdio',
      command: 'uvx',
    })
    expect(parsed.mcpServers['braid-core'].args).toContain('openapi-mcp-gateway')
  })
})
