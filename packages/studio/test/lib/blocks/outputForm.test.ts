import type { RunRecord, SkillId, SkillRunId, UserId, WorkspaceId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { formOfConversation } from '../../../src/lib/blocks/outputForm'

function makeRecord(overrides: Partial<RunRecord>): RunRecord {
  return {
    runId: 'run-1' as SkillRunId,
    workspaceId: 'w-1' as WorkspaceId,
    skillId: 'braid:ask' as SkillId,
    args: 'a question',
    resumed: false,
    startedBy: 'author' as UserId,
    startedAt: '2026-09-16T00:00:00.000Z',
    outputForm: 'blocks',
    ...overrides,
  }
}

describe('the form a conversation is held in', () => {
  it('is nothing before a conversation exists', () => {
    expect(formOfConversation([], null)).toBeNull()
  })

  it('is read off the run rather than off the reader', () => {
    const records = [makeRecord({ sessionId: 's-1', outputForm: 'prose' })]

    expect(formOfConversation(records, 's-1')).toBe('prose')
  })

  // A conversation is one answer, so later turns carry on as the first was made.
  it('is the form the earliest turn was made in', () => {
    const records = [
      makeRecord({ runId: 'run-2' as SkillRunId, sessionId: 's-1', startedAt: '2026-09-16T00:05:00.000Z', outputForm: 'blocks' }),
      makeRecord({ runId: 'run-1' as SkillRunId, sessionId: 's-1', startedAt: '2026-09-16T00:00:00.000Z', outputForm: 'prose' }),
    ]

    expect(formOfConversation(records, 's-1')).toBe('prose')
  })

  it('ignores runs from another conversation', () => {
    const records = [
      makeRecord({ runId: 'run-1' as SkillRunId, sessionId: 's-other', outputForm: 'prose' }),
      makeRecord({ runId: 'run-2' as SkillRunId, sessionId: 's-1', outputForm: 'blocks' }),
    ]

    expect(formOfConversation(records, 's-1')).toBe('blocks')
  })

  // Every run made before the question could be asked rendered blocks.
  it('reads a run with no form recorded as one that rendered', () => {
    const records = [{ ...makeRecord({ sessionId: 's-1' }), outputForm: undefined } as unknown as RunRecord]

    expect(formOfConversation(records, 's-1')).toBeNull()
  })
})
