import { describe, expect, it } from 'vitest'
import { ProductManifest, Workspace } from '../src/index.js'

const baseStorage = { kind: 'neo4j', config: { uri: 'bolt://localhost:7687', user: 'neo4j' } }

describe('ProductManifest', () => {
  it('parses minimal manifest with defaults', () => {
    const manifest = ProductManifest.parse({
      name: 'demo',
      storage: baseStorage,
    })
    expect(manifest.version).toBe('0.0.0')
    expect(manifest.ontologyId).toBe('ddd')
    expect(manifest.sources).toEqual([])
    expect(manifest.mcpServers).toEqual([])
  })

  it('parses with full source + mcp config', () => {
    const manifest = ProductManifest.parse({
      name: 'demo',
      version: '1.2.3',
      description: 'desc',
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
    expect(manifest.sources).toHaveLength(2)
    expect(manifest.mcpServers).toHaveLength(1)
  })

  it('rejects empty name', () => {
    expect(
      ProductManifest.safeParse({ name: '', storage: baseStorage }).success,
    ).toBe(false)
  })

  it('rejects missing storage', () => {
    expect(
      ProductManifest.safeParse({ name: 'demo' }).success,
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
        storage: baseStorage,
      },
    })
    expect(workspace.id).toBe('w-1')
    expect(workspace.productManifest.sources).toEqual([])
  })
})
