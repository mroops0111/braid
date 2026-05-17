import { describe, expect, it } from 'vitest'
import { ViewArtifact, ViewArtifactFile, ViewArtifactFormat, ViewKind } from '../src/index.js'

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
