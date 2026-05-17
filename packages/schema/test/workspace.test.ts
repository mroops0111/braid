import { describe, expect, it } from 'vitest'
import { ProductManifest, Workspace } from '../src/index.js'

const baseStorage = { kind: 'neo4j', config: { uri: 'bolt://localhost:7687', user: 'neo4j' } }
const baseAgents = { default: 'claude-default' }

describe('ProductManifest', () => {
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
        { id: 'redmine', transport: 'streamable-http', url: 'https://redmine.example.com/mcp' },
      ],
      storage: baseStorage,
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

describe('Workspace', () => {
  it('parses a complete workspace', () => {
    const workspace = Workspace.parse({
      id: 'w-1',
      rootPath: '/abs/workspace',
      productManifest: {
        name: 'demo',
        agents: baseAgents,
        storage: baseStorage,
      },
    })
    expect(workspace.id).toBe('w-1')
    expect(workspace.productManifest.sources).toEqual([])
  })
})
