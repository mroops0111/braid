import { describe, expect, it } from 'vitest'
import { AgentBindingDescriptor, AgentEffort, AgentKind } from '../src/index.js'

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
      id: 'claude-code',
      kind: 'claude-code',
      model: 'opus',
    })
    expect(binding.extraArgs).toEqual([])
    expect(binding.env).toEqual({})
  })

  it('parses full binding', () => {
    const binding = AgentBindingDescriptor.parse({
      id: 'claude-code',
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
