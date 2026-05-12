import { describe, expect, it } from 'vitest'
import { parseMarkdownFrontmatter } from '../../../src/infrastructure/fs/frontmatter.js'

describe('parseMarkdownFrontmatter', () => {
  it('parses YAML frontmatter and body', () => {
    const source = `---
name: telos-ask
description: ask
---
body line 1
body line 2`
    const result = parseMarkdownFrontmatter<{ name: string, description: string }>(source)
    expect(result.frontmatter.name).toBe('telos-ask')
    expect(result.body).toContain('body line 1')
  })

  it('throws when frontmatter is missing opening delimiter', () => {
    expect(() => parseMarkdownFrontmatter('no delimiter here')).toThrow(/start with "---"/)
  })

  it('throws when frontmatter is not closed', () => {
    expect(() => parseMarkdownFrontmatter('---\nname: x\nstill in fm')).toThrow(/Unterminated/)
  })
})
