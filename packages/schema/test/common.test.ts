import { describe, expect, it } from 'vitest'
import {
  AbsolutePath,
  Actor,
  AgentId,
  ClarifyCandidateId,
  ClarifyTicketId,
  CommitSha,
  EdgeId,
  ExternalReference,
  ExternalReferenceKind,
  NodeId,
  OntologyId,
  PluginId,
  ProposalId,
  SkillId,
  SkillRunId,
  SourceId,
  SourceLocation,
  SourceReference,
  Timestamp,
  UserId,
  WorkspaceId,
} from '../src/index.js'

describe('Timestamp', () => {
  it('accepts ISO 8601 with offset', () => {
    expect(Timestamp.parse('2026-05-09T12:34:56+08:00')).toBe('2026-05-09T12:34:56+08:00')
  })
  it('rejects plain date', () => {
    expect(Timestamp.safeParse('2026-05-09').success).toBe(false)
  })
  it('rejects empty string', () => {
    expect(Timestamp.safeParse('').success).toBe(false)
  })
})

describe('Branded IDs share the z.string().min(1).brand() contract', () => {
  // One representative case per schema, they all delegate to the same zod primitive,
  // so picking one (NodeId) plus a parameterised name table is enough,
  // to catch a regression that swaps the brand for a looser type.
  const schemas = {
    WorkspaceId,
    NodeId,
    EdgeId,
    SourceId,
    ProposalId,
    ClarifyTicketId,
    ClarifyCandidateId,
    SkillId,
    SkillRunId,
    PluginId,
    AgentId,
    OntologyId,
    UserId,
    AbsolutePath,
  } as const

  it.each(Object.entries(schemas))('%s accepts a non-empty string and rejects empty', (_name, schema) => {
    expect(schema.parse('x')).toBe('x')
    expect(schema.safeParse('').success).toBe(false)
  })
})

describe('SourceLocation', () => {
  it('accepts uri-only payload', () => {
    expect(SourceLocation.parse({ uri: 'file:///x.ts' })).toEqual({ uri: 'file:///x.ts' })
  })
  it('accepts full payload', () => {
    const parsed = SourceLocation.parse({
      uri: 'https://example.com/doc',
      startLine: 10,
      endLine: 20,
      anchor: 'section-1',
    })
    expect(parsed.endLine).toBe(20)
  })
  it('rejects negative line numbers', () => {
    expect(SourceLocation.safeParse({ uri: 'x', startLine: -1 }).success).toBe(false)
  })
  it('rejects empty uri', () => {
    expect(SourceLocation.safeParse({ uri: '' }).success).toBe(false)
  })
})

describe('SourceReference', () => {
  it('parses with sourceId + location', () => {
    const reference = SourceReference.parse({
      sourceId: 's-1',
      location: { uri: 'file:///x.ts' },
    })
    expect(reference.sourceId).toBe('s-1')
  })
  it('accepts optional snippet', () => {
    const reference = SourceReference.parse({
      sourceId: 's-1',
      location: { uri: 'file:///x.ts' },
      snippet: 'function foo()',
    })
    expect(reference.snippet).toBe('function foo()')
  })
})

describe('ExternalReferenceKind (open brand — concrete kinds live in plugins)', () => {
  it('accepts any non-empty string', () => {
    expect(ExternalReferenceKind.parse('github')).toBe('github')
    expect(ExternalReferenceKind.parse('linear')).toBe('linear')
  })
  it('rejects empty string', () => {
    expect(ExternalReferenceKind.safeParse('').success).toBe(false)
  })
})

describe('ExternalReference', () => {
  it('parses with arbitrary kind + url', () => {
    const reference = ExternalReference.parse({
      kind: 'github',
      url: 'https://github.com/x/y/issues/1',
      label: 'optional label',
    })
    expect(reference.kind).toBe('github')
  })
  it('rejects empty kind', () => {
    expect(ExternalReference.safeParse({ kind: '', url: 'https://x.com' }).success).toBe(false)
  })
  it('rejects non-URL', () => {
    expect(
      ExternalReference.safeParse({ kind: 'github', url: 'not-a-url' }).success,
    ).toBe(false)
  })
})

describe('CommitSha', () => {
  it('accepts 40 lowercase hex chars', () => {
    const sha = 'a'.repeat(40)
    expect(CommitSha.parse(sha)).toBe(sha)
  })
  it('rejects the wrong length', () => {
    expect(CommitSha.safeParse('a'.repeat(39)).success).toBe(false)
  })
  it('rejects uppercase, git shas are lowercase', () => {
    expect(CommitSha.safeParse('A'.repeat(40)).success).toBe(false)
  })
})

describe('Actor', () => {
  it('accepts a user id', () => {
    expect(Actor.parse('u-1')).toBe('u-1')
  })
  it('accepts the system sentinel', () => {
    expect(Actor.parse('system')).toBe('system')
  })
  it('rejects empty', () => {
    expect(Actor.safeParse('').success).toBe(false)
  })
})
