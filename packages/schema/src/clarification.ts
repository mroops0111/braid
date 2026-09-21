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
const clarificationQuestion = z.string().min(1).max(400).describe('The one question a person is asked. One doubt per clarification, so a second doubt is a second clarification.')

/**
 * Whether the question still needs an answer, and what became of it.
 *
 * Deferring is not a status.
 * A deferred question is still pending, because it still wants an answer,
 * and what changed is only that nothing waits on it any more.
 * That lives on `answerMode`, so the two questions stay separable,
 * where skipping throws a question away and deferring keeps it.
 */
export const ClarificationStatus = z.enum(['pending', 'answered', 'applied', 'skipped']).describe(
  'Where the question stands. '
  + '`pending` still wants an answer, `answered` has one, '
  + '`applied` had its answer carried into the graph, '
  + 'and `skipped` was thrown away unanswered.',
)
export type ClarificationStatus = z.infer<typeof ClarificationStatus>

export const ClarificationOrigin = z.enum(['skill', 'human']).describe('Who is asking. `skill` is a run that stopped to ask, and `human` is a person filing a doubt of their own. A run leaves it unset, which records `skill`.')
export type ClarificationOrigin = z.infer<typeof ClarificationOrigin>

export const ClarificationAmbiguityType = z.enum(['gap', 'contradiction', 'ambiguous', 'assumption']).describe(
  'What kind of doubt this is, which a person sets when filing one to steer the run that picks it up. '
  + '`gap` is something nobody wrote down, `contradiction` is two sources disagreeing, '
  + '`ambiguous` is one statement that reads two ways, '
  + 'and `assumption` is something taken for granted that needs confirming. '
  + 'A run raising a question of its own leaves it unset.',
)
export type ClarificationAmbiguityType = z.infer<typeof ClarificationAmbiguityType>

/**
 * One shape, registered twice.
 *
 * A candidate on the way in may leave its id to the server, so the body's
 * version is the same shape with that one field optional. Built from the shape
 * rather than from the registered schema, which keeps the two components apart
 * in the served document.
 */
const clarificationCandidateShape = {
  id: ClarificationCandidateId,
  description: z.string().min(1).max(200).regex(/^[^\n]+$/, 'Candidate description must be a single line').describe('This answer in one line, phrased so a person can choose between candidates without opening a source.'),
  sourceReferences: z.array(SourceReference).default([]).describe('The passages that support this answer, which is what makes it a reading rather than a guess.'),
  proposedOperations: z.array(GraphOperation).default([]).describe('The graph changes this answer would make, so picking it is enough to act on. They are checked against the graph only once a person picks this candidate, so a reading worth offering can carry changes worth questioning.'),
}

const candidateDescription = 'One answer a person can pick, offered by whoever raised the question.'

export const ClarificationCandidate = z.object(clarificationCandidateShape).describe(candidateDescription).openapi('ClarificationCandidate')

/** The same candidate with its id left to the server to mint. */
export const ClarificationCandidateDraft = z.object({
  ...clarificationCandidateShape,
  id: ClarificationCandidateId.optional().describe('Id to give this candidate. Omit it and the server derives one.'),
}).describe(candidateDescription).openapi('ClarificationCandidateDraft')
export type ClarificationCandidateDraft = z.infer<typeof ClarificationCandidateDraft>
export type ClarificationCandidate = z.infer<typeof ClarificationCandidate>

export const ClarificationAnswerMode = z.enum(['resumes', 'standing']).describe('Whether a conversation is parked on the answer. `resumes` carries a stopped run on, and `standing` records the answer for a later step. The server decides which, never the asker.')
export type ClarificationAnswerMode = z.infer<typeof ClarificationAnswerMode>

export const Clarification = HandoffOwner.extend({
  id: ClarificationId,
  workspaceId: WorkspaceId,
  question: clarificationQuestion,
  candidates: z.array(ClarificationCandidate).describe('The answers offered, which a person picks between.'),
  status: ClarificationStatus,
  answeredBy: UserId.optional().describe('Who answered. Absent while the question is open.'),
  /**
   * When somebody answered, the counterpart to a proposal's `reviewedAt`.
   *
   * Absent while a question is still open,
   * and on everything recorded before the field existed.
   */
  answeredAt: Timestamp.optional(),
  selectedCandidateId: ClarificationCandidateId.optional().describe('The candidate the person picked, when they picked one of the offered answers.'),
  resolution: z.array(GraphOperation).optional().describe('The graph changes the answer settled on, which a proposal then carries.'),
  proposalId: ProposalId.optional().describe('The proposal that carries this answer, once one has been filed for it.'),
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
   * Producing a handoff is one act whichever shape it takes,
   * so the two carry it under one word.
   * Settling them is two different acts,
   * which is why `answeredBy` and a proposal's `reviewedBy` stay apart.
   *
   * Absent on everything recorded before the field existed,
   * so a surface reads it as unknown rather than as the beginning of time.
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
  context: z.string().max(2000).optional().describe('Background the asker wrote in their own words, beyond what the question itself says.'),
  relatedNode: NodeId.optional().describe('The node the doubt is about, which is where whoever picks this up should start reading.'),
  ambiguityType: ClarificationAmbiguityType.optional(),
}).describe('A question a run could not settle on its own, waiting on a person.').openapi('Clarification')
export type Clarification = z.infer<typeof Clarification>

export const ClarificationCreate = z.object({
  workspaceId: WorkspaceId,
  question: clarificationQuestion,
  candidates: z.array(ClarificationCandidate).describe('The answers to offer. Two or three readings a person can choose between beat one question with none, since picking is faster than writing.'),
  externalReferences: z.array(ExternalReference).optional().describe('Links out to the work this doubt came from.'),
  origin: ClarificationOrigin.optional(),
  context: z.string().max(2000).optional().describe('Background beyond the question itself, such as what was read on the way to the doubt.'),
  relatedNode: NodeId.optional().describe('The node the doubt is about, which is where whoever picks this up should start reading.'),
  ambiguityType: ClarificationAmbiguityType.optional(),
})
export type ClarificationCreate = z.infer<typeof ClarificationCreate>

/**
 * The POST body for creating a clarification. Workspace comes from the path,
 * and human-authored candidates omit their id for the server to mint.
 */
export const ClarificationCreateBody = ClarificationCreate
  .omit({ workspaceId: true })
  .extend({ candidates: z.array(ClarificationCandidateDraft).describe('The answers to offer. Two or three readings a person can choose between beat one question with none, since picking is faster than writing.') })
export type ClarificationCreateBody = z.infer<typeof ClarificationCreateBody>

export const ClarificationFilter = HandoffFilter.extend({
  statuses: z.array(ClarificationStatus).optional(),
})
export type ClarificationFilter = z.infer<typeof ClarificationFilter>
