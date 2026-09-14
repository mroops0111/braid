import type { NodeTypeDescriptor } from '../src/index.js'
import { describe, expect, it } from 'vitest'
import { isViewSubject, NodeTypeId, ViewArtifact, ViewArtifactFile, ViewArtifactFormat, ViewKind, ViewSubjects } from '../src/index.js'

describe('ViewKind', () => {
  it('accepts arbitrary non-empty identifier', () => {
    expect(ViewKind.parse('docs')).toBe('docs')
    expect(ViewKind.parse('mermaid')).toBe('mermaid')
  })
  it('rejects empty', () => {
    expect(ViewKind.safeParse('').success).toBe(false)
  })
})

describe('ViewArtifactFormat (open brand — formats are plugin-extensible)', () => {
  it('accepts any non-empty string', () => {
    expect(ViewArtifactFormat.parse('markdown')).toBe('markdown')
    expect(ViewArtifactFormat.parse('asciidoc')).toBe('asciidoc')
  })
  it('rejects empty', () => {
    expect(ViewArtifactFormat.safeParse('').success).toBe(false)
  })
})

describe('ViewArtifactFile', () => {
  it('parses path + text', () => {
    const file = ViewArtifactFile.parse({ path: 'docs/index.md', text: '# Title' })
    expect(file.path).toBe('docs/index.md')
  })
  it('rejects empty path', () => {
    expect(ViewArtifactFile.safeParse({ path: '', text: 'x' }).success).toBe(false)
  })
})

describe('ViewArtifact', () => {
  it('parses with multiple files', () => {
    const artifact = ViewArtifact.parse({
      kind: 'docs',
      format: 'markdown',
      files: [
        { path: 'README.md', text: '# Braid' },
        { path: 'OVERVIEW.md', text: '# Overview' },
      ],
    })
    expect(artifact.files).toHaveLength(2)
  })
})

describe('isViewSubject', () => {
  const type = (id: string, container?: boolean): NodeTypeDescriptor => ({
    id: NodeTypeId.parse(id),
    label: id,
    ...(container === undefined ? {} : { renderHint: { container } }),
  })

  it('takes any node for a kind that declares no rule', () => {
    const subjects = ViewSubjects.parse([])
    expect(isViewSubject(subjects, type('rule'))).toBe(true)
    expect(isViewSubject(subjects, type('boundedContext', true))).toBe(true)
  })

  it('takes what the ontology calls a container, for the container rule', () => {
    const subjects = ViewSubjects.parse([{ by: 'container' }])
    expect(isViewSubject(subjects, type('boundedContext', true))).toBe(true)
    expect(isViewSubject(subjects, type('rule'))).toBe(false)
    expect(isViewSubject(subjects, type('aggregate', false))).toBe(false)
  })

  it('takes a type it names, for a kind shipped with the ontology it reads', () => {
    const subjects = ViewSubjects.parse([{ by: 'type', type: 'metric' }])
    expect(isViewSubject(subjects, type('metric'))).toBe(true)
    expect(isViewSubject(subjects, type('rule'))).toBe(false)
    expect(isViewSubject(subjects, type('boundedContext', true))).toBe(false)
  })

  it('takes a node matching any one rule, since each is its own reason', () => {
    const subjects = ViewSubjects.parse([{ by: 'container' }, { by: 'type', type: 'metric' }])
    expect(isViewSubject(subjects, type('boundedContext', true))).toBe(true)
    expect(isViewSubject(subjects, type('metric'))).toBe(true)
    expect(isViewSubject(subjects, type('rule'))).toBe(false)
  })

  it('refuses a rule naming no way to qualify', () => {
    expect(ViewSubjects.safeParse([{ by: 'whatever' }]).success).toBe(false)
  })
})
