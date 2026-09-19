import { z } from 'zod'
import {
  ClarificationCandidateId,
  ClarificationId,
  ExternalReference,
  NodeId,
  ProposalId,
  SkillId,
  SkillRunId,
  SourceReference,
  Timestamp,
  UserId,
  WorkspaceId,
} from './common.js'
import { HandoffFilter, HandoffOwner } from './handoff.js'
import { GraphOperation } from './proposal.js'

// Only the hard contract here. Authoring rules (length, tone, language) live in the skill layer.
const clarificationQuestion = z.string().min(1).max(400).describe('The single question shown to the reviewer.')

/**
 * Whether the question still needs an answer, and what became of it.
 *
 * Deferring is not a status.
 * A deferred question is still pending, because it still wants an answer,
 * and what changed is only that nothing waits on it any more.
 * That lives on `answerMode`, so the two questions stay separable,
 * where skipping throws a question away and deferring keeps it.
 */
export const ClarificationStatus = z.enum(['pending', 'answered', 'applied', 'skipped'])
export type ClarificationStatus = z.infer<typeof ClarificationStatus>

/** 'skill' = AI-emitted with candidates. 'human' = filed via Studio. */
export const ClarificationOrigin = z.enum(['skill', 'human'])
export type ClarificationOrigin = z.infer<typeof ClarificationOrigin>

/** Human picks this when filing to steer the AI. Skill clarifications leave it unset. */
export const ClarificationAmbiguityType = z.enum(['gap', 'contradiction', 'ambiguous', 'assumption'])
export type ClarificationAmbiguityType = z.infer<typeof ClarificationAmbiguityType>

export const ClarificationCandidate = z.object({
  id: ClarificationCandidateId,
  description: z.string().min(1).max(200).regex(/^[^\n]+$/, 'Candidate description must be a single line').describe('One-line summary of this candidate resolution.'),
  sourceReferences: z.array(SourceReference).default([]),
  proposedOperations: z.array(GraphOperation).default([]),
})
export type ClarificationCandidate = z.infer<typeof ClarificationCandidate>

export const ClarificationAnswerMode = z.enum(['resumes', 'standing'])
export type ClarificationAnswerMode = z.infer<typeof ClarificationAnswerMode>

export const Clarification = HandoffOwner.extend({
  id: ClarificationId,
  workspaceId: WorkspaceId,
  question: clarificationQuestion,
  candidates: z.array(ClarificationCandidate),
  status: ClarificationStatus,
  answeredBy: UserId.optional(),
  /**
   * When somebody answered, the counterpart to a proposal's `reviewedAt`.
   *
   * Absent while a question is still open, and on everything recorded
   * before the field existed.
   */
  answeredAt: Timestamp.optional(),
  selectedCandidateId: ClarificationCandidateId.optional(),
  resolution: z.array(GraphOperation).optional(),
  // Set when the resolution becomes a Proposal, so the UI can link the two.
  proposalId: ProposalId.optional(),
  externalReferences: z.array(ExternalReference).optional(),
  /**
   * The run that raised this, when a skill did. Absent on a human-filed one.
   * A run that can still be continued is answered by resuming it,
   * so the work carries on in the conversation that already read the sources,
   * rather than starting over in a second skill.
   */
  skillRunId: SkillRunId.optional(),
  /**
   * When the run handed this over, named as a proposal's is.
   *
   * Producing a handoff is one act whichever shape it takes, so the two
   * carry it under one word. Settling them is two different acts, which is
   * why `answeredBy` and a proposal's `reviewedBy` stay apart.
   *
   * Absent on everything recorded before the field existed, which is why a
   * surface treats it as unknown rather than as the beginning of time.
   */
  generatedAt: Timestamp.optional(),
  /**
   * Which skill raised this, taken from the run that filed it.
   *
   * Set by the server rather than sent, the same way a proposal's is.
   * A reader wants to know which step of the pipeline stopped to ask,
   * and the run record already holds the answer.
   */
  generatedBy: SkillId.optional(),
  /**
   * Whether a conversation is parked on this answer.
   *
   * `resumes` means a run stopped here and answering carries it on.
   * `standing` means nothing is waiting,
   * so the answer is recorded for a later step to pick up.
   * Which one it is depends on whether anybody was watching the run,
   * so the server decides it and the asker is never consulted.
   *
   * Absent on a human-filed one, and on everything recorded before this,
   * which reads as standing,
   * correct in both cases since neither has a conversation to continue.
   */
  answerMode: ClarificationAnswerMode.optional(),
  origin: ClarificationOrigin,
  // Free-form background on a human-filed issue. Skill clarifications leave it empty.
  context: z.string().max(2000).optional(),
  // Node the human believes the issue concerns, to help the AI scope its resolution.
  relatedNode: NodeId.optional(),
  ambiguityType: ClarificationAmbiguityType.optional(),
})
export type Clarification = z.infer<typeof Clarification>

export const ClarificationCreate = z.object({
  workspaceId: WorkspaceId,
  question: clarificationQuestion,
  candidates: z.array(ClarificationCandidate),
  externalReferences: z.array(ExternalReference).optional(),
  origin: ClarificationOrigin.optional(),
  context: z.string().max(2000).optional(),
  relatedNode: NodeId.optional(),
  ambiguityType: ClarificationAmbiguityType.optional(),
})
export type ClarificationCreate = z.infer<typeof ClarificationCreate>

/**
 * The POST body for creating a clarification. Workspace comes from the path,
 * and human-authored candidates omit their id for the server to mint.
 */
export const ClarificationCreateBody = ClarificationCreate
  .omit({ workspaceId: true })
  .extend({ candidates: z.array(ClarificationCandidate.partial({ id: true })) })
export type ClarificationCreateBody = z.infer<typeof ClarificationCreateBody>

export const ClarificationFilter = HandoffFilter.extend({
  statuses: z.array(ClarificationStatus).optional(),
})
export type ClarificationFilter = z.infer<typeof ClarificationFilter>
