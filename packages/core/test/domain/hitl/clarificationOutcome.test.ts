import type { ClarificationCandidateId, WorkspaceId } from '@braidhq/schema'
import { makeClarification } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { describeContinuation, outcomeOf } from '../../../src/index.js'

const WORKSPACE = 'w-1' as WorkspaceId
const CHOICE = 'cand.one' as ClarificationCandidateId

const CANDIDATES = [{
  id: CHOICE,
  description: 'Treat it as downstream',
  sourceReferences: [],
  proposedOperations: [],
}]

describe('outcomeOf', () => {
  it('reads an answered question as answered', () => {
    const clarification = makeClarification(WORKSPACE, {
      status: 'answered',
      candidates: CANDIDATES,
      selectedCandidateId: CHOICE,
    })
    expect(outcomeOf(clarification)?.outcome).toBe('answered')
  })

  // Deferring keeps the question and gives up only the conversation,
  // so the status stays pending and the mode is what moved.
  it('reads a deferred question as deferred', () => {
    const clarification = makeClarification(WORKSPACE, { answerMode: 'standing' })
    expect(outcomeOf(clarification)?.outcome).toBe('deferred')
  })

  it('reads a set-aside question as skipped', () => {
    const clarification = makeClarification(WORKSPACE, { status: 'skipped' })
    expect(outcomeOf(clarification)?.outcome).toBe('skipped')
  })

  // A run parked on this one is still rightly waiting,
  // so nothing may carry it on yet.
  it('reads a question a run is still parked on as unsettled', () => {
    const clarification = makeClarification(WORKSPACE, { answerMode: 'resumes' })
    expect(outcomeOf(clarification)).toBeNull()
  })
})

describe('describeContinuation', () => {
  it('names the chosen candidate on an answered question', () => {
    const message = describeContinuation([makeClarification(WORKSPACE, {
      status: 'answered',
      candidates: CANDIDATES,
      selectedCandidateId: CHOICE,
    })])
    expect(message).toContain('The reviewer answered: Treat it as downstream')
    expect(message).toContain('do not raise it again')
  })

  it('tells the run a deferred question is coming later', () => {
    const message = describeContinuation([makeClarification(WORKSPACE, { answerMode: 'standing' })])
    expect(message).toContain('The reviewer chose to answer this later')
    expect(message).toContain('carry on without it')
  })

  it('tells the run a skipped question was set aside', () => {
    const message = describeContinuation([makeClarification(WORKSPACE, { status: 'skipped' })])
    expect(message).toContain('set this question aside')
  })

  // One release can carry three different decisions,
  // and a run told only how many were settled cannot tell which is which.
  // Deferring leaves a question open and skipping discards it,
  // so nothing above them may announce that they were resolved.
  it('claims no state the outcomes would contradict', () => {
    const message = describeContinuation([makeClarification(WORKSPACE, { answerMode: 'standing' })])
    expect(message).not.toContain('settled')
    expect(message.split('\n')[0]).toBe('q?')
  })

  it('keeps each question with what became of it', () => {
    const message = describeContinuation([
      makeClarification(WORKSPACE, { id: 'ct-1', answerMode: 'standing' }),
      makeClarification(WORKSPACE, { id: 'ct-2', status: 'skipped' }),
    ])
    expect(message).toContain('The reviewer chose to answer this later')
    expect(message).toContain('The reviewer set this question aside')
  })

  it('leaves out a question nothing has settled', () => {
    const message = describeContinuation([makeClarification(WORKSPACE, { answerMode: 'resumes' })])
    expect(message).not.toContain('The reviewer')
  })
})
