import { describe, expect, it } from 'vitest'
import {
  AbsolutePath,
  AgentId,
  AnswerId,
  ClarifyCandidateId,
  ClarifyTicketId,
  DecisionId,
  EdgeId,
  ExternalReference,
  ExternalReferenceKind,
  NodeId,
  OntologyId,
  PluginId,
  ProposalId,
  QuestionId,
  SkillId,
  SkillRunId,
  SourceId,
  SourceLocation,
  SourceReference,
  Timestamp,
  UserId,
  WorkspaceId,
} from '../src/index.js'

describe('timestamp', () => {
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

describe('branded IDs', () => {
  const idSchemas = {
    WorkspaceId,
    NodeId,
    EdgeId,
    SourceId,
    ProposalId,
    ClarifyTicketId,
    ClarifyCandidateId,
    DecisionId,
    QuestionId,
    AnswerId,
    SkillId,
    SkillRunId,
    PluginId,
    AgentId,
    OntologyId,
    UserId,
    AbsolutePath,
  }

  for (const [name, schema] of Object.entries(idSchemas)) {
    it(`${name} accepts a non-empty string`, () => {
      expect(schema.parse('x')).toBe('x')
    })
    it(`${name} rejects empty string`, () => {
      expect(schema.safeParse('').success).toBe(false)
    })
  }
})

describe('sourceLocation', () => {
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

describe('sourceReference', () => {
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

describe('externalReferenceKind (open brand — concrete kinds live in plugins)', () => {
  it('accepts any non-empty string', () => {
    expect(ExternalReferenceKind.parse('github')).toBe('github')
    expect(ExternalReferenceKind.parse('linear')).toBe('linear')
  })
  it('rejects empty string', () => {
    expect(ExternalReferenceKind.safeParse('').success).toBe(false)
  })
})

describe('externalReference', () => {
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
