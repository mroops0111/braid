import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import {
  ProductManifest,
  ProductManifestCreate,
  ProductManifestUpdate,
  SkillPermission,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '../src/index.js'

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

describe('WorkspaceRole', () => {
  it('has owner, maintainer, guest, with server admin kept off this axis', () => {
    expect(WorkspaceRole.options).toEqual(['owner', 'maintainer', 'guest'])
  })
})

describe('SkillPermission', () => {
  it('is allow or deny', () => {
    expect(SkillPermission.options).toEqual(['allow', 'deny'])
  })
})

describe('WorkspaceMember', () => {
  it('parses a member with per-skill overrides', () => {
    const member = WorkspaceMember.parse({
      userId: 'u-1',
      role: 'maintainer',
      joinedAt: isoTimestamp,
      skillOverrides: { 'braid-extract': 'deny' },
    })
    expect(member.skillOverrides).toEqual({ 'braid-extract': 'deny' })
  })
  it('rejects an unknown role', () => {
    expect(WorkspaceMember.safeParse({ userId: 'u-1', role: 'admin', joinedAt: isoTimestamp }).success).toBe(false)
  })
})

describe('ProductManifestUpdate', () => {
  it('makes every field optional', () => {
    expect(ProductManifestUpdate.parse({})).toEqual({})
  })
})

describe('ProductManifestCreate', () => {
  it('accepts a scaffold subset with storage left to the server', () => {
    const created = ProductManifestCreate.parse({ name: 'demo' })
    expect(created.sources).toEqual([])
    expect(created.storage).toBeUndefined()
  })
  it('still requires a name', () => {
    expect(ProductManifestCreate.safeParse({}).success).toBe(false)
  })
})
