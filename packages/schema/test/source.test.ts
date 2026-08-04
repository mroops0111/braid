import { describe, expect, it } from 'vitest'
import {
  FilesystemSourceDescriptor,
  ListSourceLoadersResponse,
  LoaderKind,
  McpSourceDescriptor,
  McpSourceScope,
  SourceDescriptor,
  SourceKind,
  SourceLoaderDescriptor,
  SourceLoaderEntry,
  SourceRole,
} from '../src/index.js'

describe('SourceRole', () => {
  it('accepts any non-empty role, so an ontology declares its own set', () => {
    expect(SourceRole.parse('code')).toBe('code')
    expect(SourceRole.parse('intent')).toBe('intent')
    expect(SourceRole.parse('canon')).toBe('canon')
  })
  it('rejects an empty role', () => {
    expect(SourceRole.safeParse('').success).toBe(false)
  })
})

describe('SourceKind', () => {
  it('accepts filesystem / mcp', () => {
    expect(SourceKind.parse('filesystem')).toBe('filesystem')
    expect(SourceKind.parse('mcp')).toBe('mcp')
  })
})

describe('FilesystemSourceDescriptor', () => {
  it('parses minimal filesystem source', () => {
    const source = FilesystemSourceDescriptor.parse({
      kind: 'filesystem',
      id: 'src-api',
      role: 'code',
      name: 'api',
      path: '/abs/code/api',
    })
    expect(source.kind).toBe('filesystem')
    expect(source.path).toBe('/abs/code/api')
  })

  it('accepts optional language', () => {
    const source = FilesystemSourceDescriptor.parse({
      kind: 'filesystem',
      id: 'src-api',
      role: 'code',
      name: 'api',
      path: '/abs/code/api',
      language: 'typescript',
    })
    expect(source.language).toBe('typescript')
  })
})

describe('McpSourceDescriptor', () => {
  it('parses minimal mcp source', () => {
    const source = McpSourceDescriptor.parse({
      kind: 'mcp',
      id: 'src-redmine',
      role: 'intent',
      name: 'redmine',
      mcpServerId: 'redmine',
    })
    expect(source.kind).toBe('mcp')
    expect(source.mcpServerId).toBe('redmine')
  })

  it('parses with scope hints', () => {
    const source = McpSourceDescriptor.parse({
      kind: 'mcp',
      id: 'src-redmine',
      role: 'intent',
      name: 'redmine',
      mcpServerId: 'redmine',
      scope: { tags: ['project:DS'], paths: [] },
    })
    expect(source.scope?.tags).toEqual(['project:DS'])
  })
})

describe('SourceDescriptor (discriminated union)', () => {
  it('discriminates by kind', () => {
    const fs = SourceDescriptor.parse({
      kind: 'filesystem',
      id: 'a',
      role: 'code',
      name: 'a',
      path: '/abs',
    })
    expect(fs.kind).toBe('filesystem')

    const mcp = SourceDescriptor.parse({
      kind: 'mcp',
      id: 'b',
      role: 'intent',
      name: 'b',
      mcpServerId: 'srv',
    })
    expect(mcp.kind).toBe('mcp')
  })

  it('rejects unknown kind', () => {
    expect(
      SourceDescriptor.safeParse({ kind: 'http', id: 'a', role: 'code', name: 'a' }).success,
    ).toBe(false)
  })
})

describe('LoaderKind (open brand)', () => {
  it('accepts any non-empty loader kind', () => {
    expect(LoaderKind.parse('git')).toBe('git')
    expect(LoaderKind.parse('gdrive')).toBe('gdrive')
  })
  it('rejects empty', () => {
    expect(LoaderKind.safeParse('').success).toBe(false)
  })
})

describe('SourceLoaderDescriptor', () => {
  it('pairs a loader kind with opaque config', () => {
    const descriptor = SourceLoaderDescriptor.parse({ kind: 'git', config: { url: 'https://github.com/x/y' } })
    expect(descriptor.kind).toBe('git')
  })
})

describe('FilesystemSourceDescriptor with a loader', () => {
  it('carries the provisioning loader', () => {
    const source = FilesystemSourceDescriptor.parse({
      kind: 'filesystem',
      id: 'src-app',
      role: 'code',
      name: 'app',
      path: '/abs/code/app',
      loader: { kind: 'git', config: { url: 'https://github.com/x/y' } },
    })
    expect(source.loader?.kind).toBe('git')
  })
})

describe('McpSourceScope', () => {
  it('defaults tags and paths to empty lists', () => {
    expect(McpSourceScope.parse({})).toEqual({ tags: [], paths: [] })
  })
})

describe('SourceLoaderEntry', () => {
  it('defaults the webhook flag to false', () => {
    const entry = SourceLoaderEntry.parse({ kind: 'filesystem', pluginId: 'source-loader.filesystem' })
    expect(entry.webhook).toBe(false)
  })
})

describe('ListSourceLoadersResponse', () => {
  it('wraps the loader list', () => {
    const res = ListSourceLoadersResponse.parse({
      loaders: [{ kind: 'git', pluginId: 'source-loader.git', webhook: true }],
    })
    expect(res.loaders[0]?.webhook).toBe(true)
  })
})
