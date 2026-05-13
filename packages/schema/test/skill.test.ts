import { describe, expect, it } from 'vitest'
import {
  SkillArtifactKind,
  SkillEvent,
  SkillFrontmatter,
  SkillManifest,
  SkillOrigin,
  SkillRun,
  SkillRunStatus,
} from '../src/index.js'

const isoTimestamp = '2026-05-12T12:00:00+08:00'

describe('skillRunStatus', () => {
  it('has 4 states', () => {
    expect(SkillRunStatus.options).toEqual(['running', 'succeeded', 'failed', 'cancelled'])
  })
})

describe('skillRun (audit record)', () => {
  it('parses a running skill', () => {
    const run = SkillRun.parse({
      id: 'sr-1',
      skillId: 'extract',
      startedAt: isoTimestamp,
      status: 'running',
      triggeredBy: 'u-1',
    })
    expect(run.status).toBe('running')
  })

  it('parses a finished skill with metrics', () => {
    const run = SkillRun.parse({
      id: 'sr-1',
      skillId: 'extract',
      startedAt: isoTimestamp,
      finishedAt: isoTimestamp,
      status: 'succeeded',
      triggeredBy: 'u-1',
      durationMs: 12_345,
      tokensUsed: 8_192,
    })
    expect(run.tokensUsed).toBe(8_192)
  })

  it('parses a failed skill with error', () => {
    const run = SkillRun.parse({
      id: 'sr-1',
      skillId: 'extract',
      startedAt: isoTimestamp,
      finishedAt: isoTimestamp,
      status: 'failed',
      triggeredBy: 'u-1',
      errorMessage: 'agent timeout',
    })
    expect(run.errorMessage).toBe('agent timeout')
  })
})

describe('skillOrigin', () => {
  it('accepts builtin / workspace / extension', () => {
    expect(SkillOrigin.parse('builtin')).toBe('builtin')
    expect(SkillOrigin.parse('workspace')).toBe('workspace')
    expect(SkillOrigin.parse('extension')).toBe('extension')
  })
  it('rejects unknown origin', () => {
    expect(SkillOrigin.safeParse('marketplace').success).toBe(false)
  })
})

describe('skillFrontmatter', () => {
  it('parses minimal frontmatter with defaults (no telos extension)', () => {
    const fm = SkillFrontmatter.parse({
      name: 'telos-ask',
      description: 'answer questions',
    })
    expect(fm.disableModelInvocation).toBe(false)
    expect(fm.telos.requiredEnv).toEqual([])
    expect(fm.telos.requiredMcpServers).toEqual([])
  })

  it('parses full frontmatter with telos extension', () => {
    const fm = SkillFrontmatter.parse({
      name: 'telos-import-jira',
      description: 'sync Jira tickets',
      argumentHint: '[project-key]',
      disableModelInvocation: true,
      allowedTools: ['Read', 'Grep', 'Bash'],
      telos: {
        requiredEnv: ['JIRA_TOKEN'],
        requiredPaths: ['intent/jira'],
        requiredMcpServers: ['jira'],
      },
    })
    expect(fm.allowedTools).toEqual(['Read', 'Grep', 'Bash'])
    expect(fm.telos.requiredMcpServers).toEqual(['jira'])
  })

  it('does not mix Claude Code fields with telos extension fields', () => {
    const fm = SkillFrontmatter.parse({
      name: 'telos-ask',
      description: 'a',
      telos: { requiredEnv: ['X'] },
    })
    expect('requiredEnv' in fm).toBe(false)
    expect(fm.telos.requiredEnv).toEqual(['X'])
  })

  it('rejects empty name', () => {
    expect(
      SkillFrontmatter.safeParse({ name: '', description: 'x' }).success,
    ).toBe(false)
  })
})

describe('skillManifest', () => {
  it('parses a builtin manifest', () => {
    const manifest = SkillManifest.parse({
      id: 'ask',
      origin: 'builtin',
      path: '/abs/path/to/SKILL.md',
      frontmatter: {
        name: 'telos-ask',
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
      frontmatter: { name: 'telos-extract', description: 'extract' },
      extensionPath: '/abs/skill-extensions/telos-extract/EXTEND.md',
    })
    expect(manifest.extensionPath).toBeTruthy()
  })
})

describe('skillArtifactKind', () => {
  it('accepts proposal / clarify / decision / view', () => {
    expect(SkillArtifactKind.parse('proposal')).toBe('proposal')
    expect(SkillArtifactKind.parse('clarify')).toBe('clarify')
    expect(SkillArtifactKind.parse('decision')).toBe('decision')
    expect(SkillArtifactKind.parse('view')).toBe('view')
  })
})

describe('skillEvent (discriminated union)', () => {
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
