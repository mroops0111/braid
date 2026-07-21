import { describe, expect, it } from 'vitest'
import { parseMarkdownFrontmatter } from '../../../src/infrastructure/_shared/frontmatter.js'

describe('parseMarkdownFrontmatter', () => {
  it('parses YAML frontmatter and body', () => {
    const source = `---
name: braid-ask
description: ask
---
body line 1
body line 2`
    const result = parseMarkdownFrontmatter<{ name: string, description: string }>(source)
    expect(result.frontmatter.name).toBe('braid-ask')
    expect(result.body).toContain('body line 1')
  })

  it('normalises kebab-case keys to camelCase', () => {
    const source = `---
name: braid-ask
argument-hint: "[question]"
disable-model-invocation: true
allowed-tools: [Read, Grep]
---
body`
    const result = parseMarkdownFrontmatter<{
      argumentHint: string
      disableModelInvocation: boolean
      allowedTools: string[]
    }>(source)
    expect(result.frontmatter.argumentHint).toBe('[question]')
    expect(result.frontmatter.disableModelInvocation).toBe(true)
    expect(result.frontmatter.allowedTools).toEqual(['Read', 'Grep'])
  })

  it('normalises nested keys recursively', () => {
    const source = `---
braid:
  required-env: [BRAID_API_URL]
  required-mcp-servers: [redmine]
---
body`
    const result = parseMarkdownFrontmatter<{
      braid: { requiredEnv: string[], requiredMcpServers: string[] }
    }>(source)
    expect(result.frontmatter.braid.requiredEnv).toEqual(['BRAID_API_URL'])
    expect(result.frontmatter.braid.requiredMcpServers).toEqual(['redmine'])
  })

  it('throws when frontmatter is missing opening delimiter', () => {
    expect(() => parseMarkdownFrontmatter('no delimiter here')).toThrow(/start with "---"/)
  })

  it('throws when frontmatter is not closed', () => {
    expect(() => parseMarkdownFrontmatter('---\nname: x\nstill in fm')).toThrow(/Unterminated/)
  })
})
