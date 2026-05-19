import { describe, expect, it } from 'vitest'
import {
  FilesystemSourceDescriptor,
  McpSourceDescriptor,
  SourceDescriptor,
  SourceKind,
  SourceRole,
} from '../src/index.js'

describe('SourceRole', () => {
  it('accepts code / intent', () => {
    expect(SourceRole.parse('code')).toBe('code')
    expect(SourceRole.parse('intent')).toBe('intent')
  })
  it('rejects unknown role', () => {
    expect(SourceRole.safeParse('external').success).toBe(false)
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
