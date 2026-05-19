import { describe, expect, it } from 'vitest'
import { AgentBindingDescriptor, AgentEffort, AgentKind, AgentRoutingConfig, TaskName } from '../src/index.js'

describe('TaskName', () => {
  it('accepts non-empty string', () => {
    expect(TaskName.parse('extract')).toBe('extract')
  })
  it('rejects empty', () => {
    expect(TaskName.safeParse('').success).toBe(false)
  })
})

describe('AgentKind (open brand)', () => {
  it('accepts claude-code', () => {
    expect(AgentKind.parse('claude-code')).toBe('claude-code')
  })
  it('accepts future kinds like anthropic-api / cursor / ollama / codex / cline', () => {
    expect(AgentKind.parse('anthropic-api')).toBe('anthropic-api')
    expect(AgentKind.parse('ollama')).toBe('ollama')
  })
})

describe('AgentEffort', () => {
  it('accepts low / medium / high', () => {
    expect(AgentEffort.parse('high')).toBe('high')
    expect(AgentEffort.parse('medium')).toBe('medium')
    expect(AgentEffort.parse('low')).toBe('low')
  })
  it('rejects unknown', () => {
    expect(AgentEffort.safeParse('ultra').success).toBe(false)
  })
})

describe('AgentBindingDescriptor', () => {
  it('parses minimal binding', () => {
    const binding = AgentBindingDescriptor.parse({
      id: 'claude-default',
      kind: 'claude-code',
      model: 'opus',
    })
    expect(binding.extraArgs).toEqual([])
    expect(binding.env).toEqual({})
  })

  it('parses full binding', () => {
    const binding = AgentBindingDescriptor.parse({
      id: 'claude-default',
      kind: 'claude-code',
      model: 'opus',
      effort: 'high',
      extraArgs: ['--verbose'],
      env: { ANTHROPIC_LOG: 'debug' },
    })
    expect(binding.effort).toBe('high')
    expect(binding.extraArgs).toEqual(['--verbose'])
  })

  it('rejects empty model', () => {
    expect(
      AgentBindingDescriptor.safeParse({ id: 'a', kind: 'claude-code', model: '' }).success,
    ).toBe(false)
  })
})

describe('AgentRoutingConfig', () => {
  it('parses default + tasks map', () => {
    const config = AgentRoutingConfig.parse({
      default: 'claude-default',
      tasks: { extract: 'claude-default', ask: 'claude-fast' },
    })
    expect(config.tasks.ask).toBe('claude-fast')
  })

  it('tasks defaults to empty map', () => {
    const config = AgentRoutingConfig.parse({ default: 'claude-default' })
    expect(config.tasks).toEqual({})
  })

  it('rejects empty default', () => {
    expect(AgentRoutingConfig.safeParse({ default: '' }).success).toBe(false)
  })
})
