import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { type McpServerConfig, McpServerId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { buildClaudeMcpConfig, writeClaudeMcpConfig } from '../src/claudeMcpConfig.js'

const BRAID_CORE_STDIO: McpServerConfig = {
  id: McpServerId.parse('braid-core'),
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
      { id: McpServerId.parse('jira'), transport: 'streamable-http', url: 'https://jira.example/mcp' },
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
      { id: McpServerId.parse('braid-core'), transport: 'streamable-http', url: 'http://override.example/mcp' },
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

describe('env and header variable resolution', () => {
  // A literal `${VAR}` reference, written so it is not read as a template literal.
  // eslint-disable-next-line no-template-curly-in-string
  const tokenRef = '${BRAID_TEST_TOKEN}'
  // eslint-disable-next-line no-template-curly-in-string
  const missingRef = '${BRAID_TEST_MISSING}'

  it('resolves references in stdio env and http headers from the parent process env', () => {
    process.env.BRAID_TEST_TOKEN = 'secret-123'
    try {
      const stdio = buildClaudeMcpConfig([
        { id: McpServerId.parse('x'), transport: 'stdio', command: 'run', env: { TOKEN: tokenRef } },
      ])
      expect((stdio.mcpServers.x as { env: Record<string, string> }).env.TOKEN).toBe('secret-123')

      const http = buildClaudeMcpConfig([
        { id: McpServerId.parse('y'), transport: 'streamable-http', url: 'https://h/mcp', headers: { Authorization: `Bearer ${tokenRef}` } },
      ])
      expect((http.mcpServers.y as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer secret-123')
    }
    finally {
      delete process.env.BRAID_TEST_TOKEN
    }
  })

  it('throws a clear error naming the missing variable', () => {
    delete process.env.BRAID_TEST_MISSING
    expect(() => buildClaudeMcpConfig([
      { id: McpServerId.parse('x'), transport: 'stdio', command: 'run', env: { TOKEN: missingRef } },
    ])).toThrow(/BRAID_TEST_MISSING.*is not set/)
  })
})
