import { describe, expect, it } from 'vitest'
import { AgentRoutingConfig, TaskName } from '../src/index.js'

describe('taskName', () => {
  it('accepts non-empty string', () => {
    expect(TaskName.parse('extract')).toBe('extract')
  })
  it('rejects empty', () => {
    expect(TaskName.safeParse('').success).toBe(false)
  })
})

describe('agentRoutingConfig', () => {
  it('parses default + tasks map', () => {
    const config = AgentRoutingConfig.parse({
      default: 'claudeCode',
      tasks: { extract: 'claudeCode', ask: 'anthropicApi' },
    })
    expect(config.tasks.ask).toBe('anthropicApi')
  })

  it('tasks defaults to empty map', () => {
    const config = AgentRoutingConfig.parse({ default: 'anthropicApi' })
    expect(config.tasks).toEqual({})
  })

  it('rejects empty default', () => {
    expect(AgentRoutingConfig.safeParse({ default: '' }).success).toBe(false)
  })
})
