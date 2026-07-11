import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'

import {
  RunRecord,
  SkillArtifactKind,
  SkillEvent,
  SkillFrontmatter,
  SkillManifest,
  SkillOrigin,
} from '../src/index.js'

describe('SkillOrigin', () => {
  it('accepts builtin / workspace / extension', () => {
    expect(SkillOrigin.parse('builtin')).toBe('builtin')
    expect(SkillOrigin.parse('workspace')).toBe('workspace')
    expect(SkillOrigin.parse('extension')).toBe('extension')
  })
  it('rejects unknown origin', () => {
    expect(SkillOrigin.safeParse('marketplace').success).toBe(false)
  })
})

describe('SkillFrontmatter', () => {
  it('parses minimal frontmatter with defaults (no braid extension)', () => {
    const fm = SkillFrontmatter.parse({
      name: 'braid-ask',
      description: 'answer questions',
    })
    expect(fm.disableModelInvocation).toBe(false)
    expect(fm.braid.requiredEnv).toEqual([])
    expect(fm.braid.requiredMcpServers).toEqual([])
  })

  it('parses full frontmatter with braid extension', () => {
    const fm = SkillFrontmatter.parse({
      name: 'braid-import-jira',
      description: 'sync Jira tickets',
      argumentHint: '[project-key]',
      disableModelInvocation: true,
      allowedTools: ['Read', 'Grep', 'Bash'],
      braid: {
        requiredEnv: ['JIRA_TOKEN'],
        requiredMcpServers: ['jira'],
      },
    })
    expect(fm.allowedTools).toEqual(['Read', 'Grep', 'Bash'])
    expect(fm.braid.requiredMcpServers).toEqual(['jira'])
  })

  it('does not mix Claude Code fields with braid extension fields', () => {
    const fm = SkillFrontmatter.parse({
      name: 'braid-ask',
      description: 'a',
      braid: { requiredEnv: ['X'] },
    })
    expect('requiredEnv' in fm).toBe(false)
    expect(fm.braid.requiredEnv).toEqual(['X'])
  })

  it('parses inputs[] with text and pick + static provider', () => {
    const fm = SkillFrontmatter.parse({
      name: 'braid-ask',
      description: 'answer questions',
      braid: {
        inputs: [
          { name: 'question', label: 'Question', kind: 'text', multiline: true },
          {
            name: 'mode',
            label: 'Mode',
            kind: 'pick',
            provider: {
              type: 'static',
              options: [
                { value: '', label: 'Detailed' },
                { value: 'concise', label: 'Concise' },
              ],
            },
            default: '',
          },
        ],
      },
    })
    expect(fm.braid.inputs?.length).toBe(2)
    const inputs = fm.braid.inputs ?? []
    expect(inputs[0]?.kind).toBe('text')
    const picked = inputs[1]
    expect(picked?.kind).toBe('pick')
    if (picked && picked.kind === 'pick')
      expect(picked.provider.type).toBe('static')
  })

  it('rejects pick input without provider', () => {
    expect(
      SkillFrontmatter.safeParse({
        name: 'x',
        description: 'y',
        braid: { inputs: [{ name: 'mode', label: 'Mode', kind: 'pick' }] },
      }).success,
    ).toBe(false)
  })

  it('rejects input name that is not lowerCamelCase identifier', () => {
    expect(
      SkillFrontmatter.safeParse({
        name: 'x',
        description: 'y',
        braid: { inputs: [{ name: 'Bad-Name', label: 'X', kind: 'text' }] },
      }).success,
    ).toBe(false)
  })

  it('rejects empty name', () => {
    expect(
      SkillFrontmatter.safeParse({ name: '', description: 'x' }).success,
    ).toBe(false)
  })
})

describe('SkillManifest', () => {
  it('parses a builtin manifest', () => {
    const manifest = SkillManifest.parse({
      id: 'ask',
      origin: 'builtin',
      path: '/abs/path/to/SKILL.md',
      frontmatter: {
        name: 'braid-ask',
        description: 'answer questions',
      },
    })
    expect(manifest.origin).toBe('builtin')
    expect(manifest.extensionPath).toBeUndefined()
  })

  it('parses a manifest with extension', () => {
    const manifest = SkillManifest.parse({
      id: 'extract',
      origin: 'builtin',
      path: '/abs/SKILL.md',
      frontmatter: { name: 'braid-extract', description: 'extract' },
      extensionPath: '/abs/skill-extensions/braid-extract/EXTEND.md',
    })
    expect(manifest.extensionPath).toBeTruthy()
  })

  it('parses a plugin manifest carrying pluginId for sidebar provenance', () => {
    const manifest = SkillManifest.parse({
      id: 'redoc-design',
      origin: 'plugin',
      path: '/abs/SKILL.md',
      frontmatter: { name: 'redoc-design', description: 'design' },
      pluginId: 'redoc-ddd',
    })
    expect(manifest.pluginId).toBe('redoc-ddd')
  })

  it('parses braid extension with category + order for sidebar grouping', () => {
    const manifest = SkillManifest.parse({
      id: 'extract',
      origin: 'builtin',
      path: '/abs/SKILL.md',
      frontmatter: {
        name: 'braid-extract',
        description: 'extract',
        braid: { category: 'build', order: 100 },
      },
    })
    expect(manifest.frontmatter.braid.category).toBe('build')
    expect(manifest.frontmatter.braid.order).toBe(100)
  })

  it('leaves category and order undefined when omitted (skill lands in Custom group)', () => {
    const manifest = SkillManifest.parse({
      id: 'misc',
      origin: 'workspace',
      path: '/abs/SKILL.md',
      frontmatter: { name: 'misc', description: 'a workspace one-off' },
    })
    expect(manifest.frontmatter.braid.category).toBeUndefined()
    expect(manifest.frontmatter.braid.order).toBeUndefined()
  })
})

describe('SkillArtifactKind', () => {
  it('accepts proposal / clarify / view', () => {
    expect(SkillArtifactKind.parse('proposal')).toBe('proposal')
    expect(SkillArtifactKind.parse('clarify')).toBe('clarify')
    expect(SkillArtifactKind.parse('view')).toBe('view')
  })
  it('rejects the removed decision kind', () => {
    expect(SkillArtifactKind.safeParse('decision').success).toBe(false)
  })
})

describe('SkillEvent (discriminated union)', () => {
  it('parses started', () => {
    const evt = SkillEvent.parse({
      type: 'started',
      runId: 'sr-1',
      skillId: 'ask',
      args: 'what is X',
      at: isoTimestamp,
    })
    if (evt.type !== 'started')
      throw new Error('unexpected')
    expect(evt.args).toBe('what is X')
    expect(evt.resumed).toBe(false)
  })

  it('parses started with resumed=true', () => {
    const evt = SkillEvent.parse({
      type: 'started',
      runId: 'sr-2',
      skillId: 'ask',
      args: 'follow up question',
      resumed: true,
      at: isoTimestamp,
    })
    if (evt.type !== 'started')
      throw new Error('unexpected')
    expect(evt.resumed).toBe(true)
  })

  it('parses session-started', () => {
    const evt = SkillEvent.parse({
      type: 'session-started',
      sessionId: 'abc-123-uuid',
    })
    if (evt.type !== 'session-started')
      throw new Error('unexpected')
    expect(evt.sessionId).toBe('abc-123-uuid')
  })

  it('parses message', () => {
    expect(SkillEvent.parse({ type: 'message', text: 'hi' }).type).toBe('message')
  })

  it('parses tool-call', () => {
    expect(SkillEvent.parse({ type: 'tool-call', tool: 'Read', args: { path: '/x' } }).type).toBe('tool-call')
  })

  it('parses tool-call with optional toolCallId', () => {
    const evt = SkillEvent.parse({
      type: 'tool-call',
      tool: 'Read',
      args: { path: '/x' },
      toolCallId: 'toolu_abc',
    })
    if (evt.type !== 'tool-call')
      throw new Error('unexpected')
    expect(evt.toolCallId).toBe('toolu_abc')
  })

  it('parses tool-result', () => {
    const evt = SkillEvent.parse({
      type: 'tool-result',
      toolCallId: 'toolu_abc',
      output: 'file contents',
      isError: false,
    })
    if (evt.type !== 'tool-result')
      throw new Error('unexpected')
    expect(evt.toolCallId).toBe('toolu_abc')
    expect(evt.isError).toBe(false)
  })

  it('rejects tool-result without required fields', () => {
    expect(SkillEvent.safeParse({ type: 'tool-result' }).success).toBe(false)
    expect(SkillEvent.safeParse({ type: 'tool-result', toolCallId: 'x', output: 'y' }).success).toBe(false)
  })

  it('parses artifact-written', () => {
    const evt = SkillEvent.parse({
      type: 'artifact-written',
      artifactKind: 'proposal',
      artifactId: 'p-1',
      path: '/abs/artifacts/proposals/pending/p-1.json',
    })
    if (evt.type !== 'artifact-written')
      throw new Error('unexpected')
    expect(evt.artifactKind).toBe('proposal')
  })

  it('parses completed', () => {
    const evt = SkillEvent.parse({
      type: 'completed',
      runId: 'sr-1',
      exitCode: 0,
      at: isoTimestamp,
    })
    expect(evt.type).toBe('completed')
  })

  it('parses error', () => {
    expect(SkillEvent.parse({ type: 'error', message: 'boom', at: isoTimestamp }).type).toBe('error')
  })

  it('rejects unknown type', () => {
    expect(SkillEvent.safeParse({ type: 'whatever' }).success).toBe(false)
  })
})

describe('RunRecord', () => {
  it('parses a minimal in-progress record (resumed defaults to false)', () => {
    const record = RunRecord.parse({
      runId: 'sr-1',
      workspaceId: 'demo',
      skillId: 'braid-ask',
      args: 'hi',
      startedAt: isoTimestamp,
    })

    expect(record.resumed).toBe(false)
    expect(record.completedAt).toBeUndefined()
    expect(record.exitCode).toBeUndefined()
  })

  it('parses a completed record with sessionId and exitCode', () => {
    const record = RunRecord.parse({
      runId: 'sr-2',
      workspaceId: 'demo',
      skillId: 'braid-ask',
      args: 'hi',
      resumed: true,
      sessionId: 'sess-abc',
      startedAt: isoTimestamp,
      completedAt: isoTimestamp,
      exitCode: 0,
    })

    expect(record.sessionId).toBe('sess-abc')
    expect(record.exitCode).toBe(0)
  })
})
