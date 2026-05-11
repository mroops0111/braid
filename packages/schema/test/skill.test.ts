import { describe, expect, it } from 'vitest'
import { SkillRun, SkillRunStatus } from '../src/index.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00'

describe('skillRunStatus', () => {
  it('has 4 states', () => {
    expect(SkillRunStatus.options).toEqual(['running', 'succeeded', 'failed', 'cancelled'])
  })
})

describe('skillRun', () => {
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
