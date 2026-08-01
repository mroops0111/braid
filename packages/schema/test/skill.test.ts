import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'

import {
  RunRecord,
  SessionMetadata,
  SkillAgentOverride,
  SkillArtifactKind,
  SkillCategory,
  SkillEvent,
  SkillFrontmatter,
  SkillInputDescriptor,
  SkillInputFallback,
  SkillInputOptionsResponse,
  SkillManifest,
  SkillOrigin,
} from '../src/index.js'

describe('SkillOrigin', () => {
  it('accepts builtin, plugin, workspace, extension', () => {
    expect(SkillOrigin.options).toEqual(['builtin', 'plugin', 'workspace', 'extension'])
  })
  it('rejects unknown origin', () => {
    expect(SkillOrigin.safeParse('marketplace').success).toBe(false)
  })
})

describe('SkillCategory', () => {
  it('maps to the Studio sidebar sections', () => {
    expect(SkillCategory.options).toEqual(['ask', 'build', 'generate'])
  })
})

describe('SkillFrontmatter', () => {
  it('parses minimal frontmatter with defaults (no braid extension)', () => {
    const fm = SkillFrontmatter.parse({
      name: 'ask',
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
      name: 'ask',
      description: 'a',
      braid: { requiredEnv: ['X'] },
    })
    expect('requiredEnv' in fm).toBe(false)
    expect(fm.braid.requiredEnv).toEqual(['X'])
  })

  it('parses inputs[] with text and pick + static provider', () => {
    const fm = SkillFrontmatter.parse({
      name: 'ask',
      description: 'answer questions',
      braid: {
        inputs: [
          { name: 'question', label: 'Question', kind: 'text', multiline: true },
          {
            name: 'mode',
            label: 'Mode',
            kind: 'pick',
            provider: {
              kind: 'static',
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
      expect(picked.provider.kind).toBe('static')
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

  it('accepts a per-skill braid.agent override', () => {
    const fm = SkillFrontmatter.parse({
      name: 'extract',
      description: 'x',
      braid: { agent: { kind: 'claude-code', effort: 'low' } },
    })
    expect(fm.braid.agent?.effort).toBe('low')
    expect(fm.braid.agent?.kind).toBe('claude-code')
  })
})

describe('SkillAgentOverride', () => {
  it('allows every field to be omitted', () => {
    expect(SkillAgentOverride.parse({})).toEqual({})
  })
  it('rejects an unknown effort', () => {
    expect(SkillAgentOverride.safeParse({ effort: 'ultra' }).success).toBe(false)
  })
})

describe('SkillInputFallback', () => {
  it('defaults to text so an empty option set swaps to free-text', () => {
    expect(SkillInputFallback.parse(undefined)).toBe('text')
  })
  it('rejects an unknown fallback', () => {
    expect(SkillInputFallback.safeParse('hide').success).toBe(false)
  })
})

describe('SkillInputDescriptor multi-pick', () => {
  it('parses a multi-pick backed by a static provider', () => {
    const input = SkillInputDescriptor.parse({
      name: 'tags',
      label: 'Tags',
      kind: 'multi-pick',
      provider: { kind: 'static', options: [{ value: 'a', label: 'A' }] },
    })
    expect(input.kind).toBe('multi-pick')
  })
})

describe('SkillInputOptionsResponse', () => {
  it('carries dynamic options with an optional sourceId', () => {
    const res = SkillInputOptionsResponse.parse({
      items: [{ value: 'intent/cart.md', label: 'cart.md', sourceId: 'src-prd' }],
    })
    expect(res.items[0]?.sourceId).toBe('src-prd')
  })
})

describe('SkillManifest', () => {
  it('parses a builtin manifest', () => {
    const manifest = SkillManifest.parse({
      id: 'ask',
      origin: 'builtin',
      path: '/abs/path/to/SKILL.md',
      frontmatter: {
        name: 'ask',
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
      frontmatter: { name: 'extract', description: 'extract' },
      extensionPath: '/abs/skill-extensions/ddd-extract/EXTEND.md',
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
        name: 'extract',
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
      skillId: 'braid:ask',
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
      skillId: 'braid:ask',
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

describe('SessionMetadata', () => {
  it('allows a null title, the reviewer has not named the session yet', () => {
    const meta = SessionMetadata.parse({ sessionId: 'sess-1', title: null, updatedAt: isoTimestamp })
    expect(meta.title).toBeNull()
  })
  it('rejects an empty sessionId', () => {
    expect(SessionMetadata.safeParse({ sessionId: '', title: null, updatedAt: isoTimestamp }).success).toBe(false)
  })
})

describe('SkillEvent surfacing variants', () => {
  it('accepts the thinking, rate-limit, and usage events', () => {
    expect(SkillEvent.parse({ type: 'thinking', text: 'why' })).toMatchObject({ type: 'thinking', text: 'why' })
    expect(SkillEvent.parse({ type: 'rate-limit', status: 'rejected', resetsAt: 1 })).toMatchObject({ type: 'rate-limit', status: 'rejected' })
    expect(SkillEvent.parse({ type: 'usage', costUsd: 0.1, turns: 2 })).toMatchObject({ type: 'usage', costUsd: 0.1, turns: 2 })
  })

  it('lets usage omit every optional metric', () => {
    expect(SkillEvent.parse({ type: 'usage' })).toEqual({ type: 'usage' })
  })
})
