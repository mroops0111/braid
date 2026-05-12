import { describe, expect, it } from 'vitest'
import { PluginConfig, ProductManifest, Workspace } from '../src/index.js'

const baseStorage = { kind: 'neo4j', config: { uri: 'bolt://localhost:7687', user: 'neo4j' } }
const baseAgents = { default: 'claude-default' }

describe('pluginConfig', () => {
  it('defaults plugins to empty array', () => {
    expect(PluginConfig.parse({})).toEqual({ plugins: [] })
  })
  it('parses with plugin descriptors', () => {
    const config = PluginConfig.parse({
      plugins: [
        { pluginId: 'generator-mermaid', type: 'generator', config: {} },
      ],
    })
    expect(config.plugins).toHaveLength(1)
  })
})

describe('productManifest', () => {
  it('parses minimal manifest with defaults', () => {
    const manifest = ProductManifest.parse({
      name: 'demo',
      agents: baseAgents,
      storage: baseStorage,
    })
    expect(manifest.version).toBe('0.0.0')
    expect(manifest.ontologyId).toBe('ddd')
    expect(manifest.sources).toEqual([])
    expect(manifest.mcpServers).toEqual([])
    expect(manifest.agentBindings).toEqual([])
    expect(manifest.channels).toEqual([])
  })

  it('parses with full source + mcp config', () => {
    const manifest = ProductManifest.parse({
      name: 'demo',
      version: '1.2.3',
      description: 'desc',
      agents: { default: 'claude-default', tasks: { extract: 'claude-default' } },
      agentBindings: [
        {
          id: 'claude-default',
          kind: 'claude-code',
          model: 'opus',
          effort: 'high',
        },
      ],
      sources: [
        {
          kind: 'filesystem',
          id: 'src-api',
          role: 'code',
          name: 'api',
          path: '/abs/code',
        },
        {
          kind: 'mcp',
          id: 'src-redmine',
          role: 'intent',
          name: 'redmine',
          mcpServerId: 'redmine',
        },
      ],
      mcpServers: [
        { id: 'redmine', transport: 'stdio', command: 'npx', args: ['-y', '@telos/mcp-redmine'] },
      ],
      storage: baseStorage,
      channels: [{ kind: 'http', config: { port: 4321 } }],
    })
    expect(manifest.agents.tasks.extract).toBe('claude-default')
    expect(manifest.sources).toHaveLength(2)
    expect(manifest.mcpServers).toHaveLength(1)
  })

  it('rejects empty name', () => {
    expect(
      ProductManifest.safeParse({ name: '', agents: baseAgents, storage: baseStorage }).success,
    ).toBe(false)
  })

  it('rejects missing storage', () => {
    expect(
      ProductManifest.safeParse({ name: 'demo', agents: baseAgents }).success,
    ).toBe(false)
  })
})

describe('workspace', () => {
  it('parses a complete workspace', () => {
    const workspace = Workspace.parse({
      id: 'w-1',
      rootPath: '/abs/workspace',
      productManifest: {
        name: 'demo',
        agents: baseAgents,
        storage: baseStorage,
      },
      pluginConfig: { plugins: [] },
    })
    expect(workspace.id).toBe('w-1')
    expect(workspace.productManifest.sources).toEqual([])
  })
})
