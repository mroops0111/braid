import type { CommitMessage, ProposalId, UserId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { parseCommitMessage, serializeCommitMessage } from '../../../src/infrastructure/history/commitMessage.js'

describe('commitMessage round-trip', () => {
  it('preserves a single-line subject and its trailers', () => {
    const message: CommitMessage = {
      kind: 'proposal-reject',
      subject: 'rejected prop-1: wrong bounded context',
      userId: 'studio-user' as UserId,
      proposalId: 'prop-2026-05-30-aaaa' as ProposalId,
    }
    expect(parseCommitMessage(serializeCommitMessage(message))).toEqual(message)
  })

  it('keeps every line of a multi-line reason', () => {
    const message: CommitMessage = {
      kind: 'proposal-reject',
      subject: 'rejected prop-1: wrong context\nshould be aggregate X\nsee RFC 12',
      userId: 'studio-user' as UserId,
      proposalId: 'prop-2026-05-30-aaaa' as ProposalId,
    }
    const parsed = parseCommitMessage(serializeCommitMessage(message))
    expect(parsed.subject).toBe(message.subject)
    expect(parsed).toEqual(message)
  })

  it('keeps the git subject to the first line', () => {
    const serialized = serializeCommitMessage({
      kind: 'clarification-answer',
      subject: 'answered clar-1: yes\nbut only for tenants on the new plan',
      userId: 'studio-user' as UserId,
    })
    expect(serialized.split('\n')[0]).toBe('clarification-answer: answered clar-1: yes')
  })

  it('does not let a trailer-shaped body line corrupt the real trailers', () => {
    const message: CommitMessage = {
      kind: 'proposal-reject',
      subject: 'rejected prop-1: see note\nKind: not-a-real-trailer',
      userId: 'studio-user' as UserId,
      proposalId: 'prop-2026-05-30-aaaa' as ProposalId,
    }
    const parsed = parseCommitMessage(serializeCommitMessage(message))
    expect(parsed.kind).toBe('proposal-reject')
    expect(parsed.subject).toBe(message.subject)
  })
})
