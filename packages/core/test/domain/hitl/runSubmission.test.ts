import type { SkillRunId, WorkspaceId } from '@braidhq/schema'
import type { RunSubmissions } from '../../../src/index.js'
import { makeClarification, makeProposal } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { clarificationSubmission, proposalSubmission, RUN_SUBMISSION_RULES } from '../../../src/index.js'

const WORKSPACE = 'w-1' as WorkspaceId
const RUN = 'skill-run-1' as SkillRunId

const NOTHING: RunSubmissions = { proposals: [], blocking: [] }

function wrote(options: { proposals?: number, blocking?: number }): RunSubmissions {
  return {
    proposals: Array.from({ length: options.proposals ?? 0 }, (_, index) =>
      makeProposal(WORKSPACE, { id: `p-${index}`, skillRunId: RUN })),
    blocking: Array.from({ length: options.blocking ?? 0 }, (_, index) =>
      makeClarification(WORKSPACE, { id: `ct-${index}`, skillRunId: RUN, answerMode: 'resumes' })),
  }
}

describe('proposalSubmission', () => {
  it('lets a run that has written nothing propose', () => {
    expect(proposalSubmission.refuse(RUN, NOTHING)).toBeNull()
  })

  // Two proposals from one run is the model splitting arbitrarily, and it
  // costs a reviewer two decisions where the run made one.
  it('refuses a second proposal from the same run', () => {
    expect(proposalSubmission.refuse(RUN, wrote({ proposals: 1 }))).toMatch(/already proposed/)
  })

  it('refuses a proposal from a run parked on a question, and names the question', () => {
    expect(proposalSubmission.refuse(RUN, wrote({ blocking: 1 }))).toMatch(/ct-0/)
  })

  // Asking is what makes a run stop, so having asked is checked before having
  // proposed would ever come up, and the message that fits is the first one.
  it('names the proposal it already made when both are true', () => {
    expect(proposalSubmission.refuse(RUN, wrote({ proposals: 1, blocking: 1 }))).toMatch(/already proposed/)
  })
})

describe('clarificationSubmission', () => {
  it('lets a run ask as many times as it needs to', () => {
    expect(clarificationSubmission.refuse(RUN, NOTHING)).toBeNull()
    expect(clarificationSubmission.refuse(RUN, wrote({ blocking: 3 }))).toBeNull()
  })

  // A question from a run that has decided arrives too late to be worth
  // anything, since the reviewer already holds what the answer might undo.
  it('refuses a question from a run that already proposed', () => {
    expect(clarificationSubmission.refuse(RUN, wrote({ proposals: 1 }))).toMatch(/cannot also ask/)
  })
})

describe('rUN_SUBMISSION_RULES', () => {
  it('holds one rule per kind, so a lookup can never find two', () => {
    const kinds = RUN_SUBMISSION_RULES.map(rule => rule.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
  })
})
