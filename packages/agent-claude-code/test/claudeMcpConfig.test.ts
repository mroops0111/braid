import type { McpServerConfig, McpServerId } from '@braidhq/schema'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildClaudeMcpConfig, writeClaudeMcpConfig } from '../src/claudeMcpConfig.js'

const BRAID_CORE_STDIO: McpServerConfig = {
  id: 'braid-core' as McpServerId,
  transport: 'stdio',
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

describe('buildClaudeMcpConfig', () => {
  it('emits a streamable-http server as a claude-cli http entry', () => {
    const config = buildClaudeMcpConfig([
      { id: 'jira' as McpServerId, transport: 'streamable-http', url: 'https://jira.example/mcp' },
    ])
    expect(config.mcpServers.jira).toEqual({ type: 'http', url: 'https://jira.example/mcp' })
  })

  it('emits a stdio server with command and args', () => {
    const config = buildClaudeMcpConfig([BRAID_CORE_STDIO])
    expect(config.mcpServers['braid-core']).toEqual({
      type: 'stdio',
      command: 'uvx',
      args: BRAID_CORE_STDIO.transport === 'stdio' ? BRAID_CORE_STDIO.args : undefined,
    })
  })

  it('lets a later entry override an earlier one with the same id', () => {
    const config = buildClaudeMcpConfig([
      BRAID_CORE_STDIO,
      { id: 'braid-core' as McpServerId, transport: 'streamable-http', url: 'http://override.example/mcp' },
    ])
    expect(config.mcpServers['braid-core']).toEqual({ type: 'http', url: 'http://override.example/mcp' })
  })
})

describe('writeClaudeMcpConfig', () => {
  it('writes the config to a per-workspace file inside the target directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'braid-mcp-'))
    const written = await writeClaudeMcpConfig(dir, 'ws-1', [BRAID_CORE_STDIO])
    expect(written.endsWith('.braid-mcp-ws-1.json')).toBe(true)
    const parsed = JSON.parse(await readFile(written, 'utf-8'))
    expect(parsed.mcpServers['braid-core']).toMatchObject({ type: 'stdio', command: 'uvx' })
    expect(parsed.mcpServers['braid-core'].args).toContain('openapi-mcp-gateway')
  })
})
