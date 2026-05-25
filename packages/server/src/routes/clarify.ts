import type { ClarifyTicketRepository, DecisionRepository, HITLService } from '@braidhq/core'
import type { ClarifyTicketId as ClarifyTicketIdType, DecisionAction, WorkspaceId } from '@braidhq/schema'
import { newClarifyCandidateId } from '@braidhq/core'
import { ClarifyCandidate, ClarifyCandidateId, ClarifyDraft, ClarifyStatus, ClarifyTicketId, ProposalId, UserId } from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { assertEntityInWorkspace } from './helpers.js'

async function latestRationale(
  decisions: DecisionRepository,
  workspaceId: WorkspaceId,
  ticketId: ClarifyTicketIdType,
  action: DecisionAction,
): Promise<string | undefined> {
  const all = await decisions.list({ workspaceId, actions: [action] })
  const match = all
    .filter(d => d.references.clarifyTicketId === ticketId && typeof d.rationale === 'string')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0]
  return match?.rationale
}

const ListQuerySchema = z.object({
  status: z.union([ClarifyStatus, z.array(ClarifyStatus)]).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})

// Reviewer-facing answer body. The selection is either an existing
// `candidateId` or a freshly authored `customCandidate` (description
// only — the server appends it to the ticket and answers in one
// transaction). `note` is a free-text rationale that survives on the
// Decision log; the GET projection surfaces it back as `answerNote`.
const AnswerBodySchema = z
  .object({
    candidateId: ClarifyCandidateId.optional(),
    customCandidate: z
      .object({ description: z.string().min(1) })
      .optional(),
    userId: UserId,
    note: z.string().min(1).optional(),
  })
  .refine(
    body => Boolean(body.candidateId) !== Boolean(body.customCandidate),
    { message: 'Provide exactly one of candidateId or customCandidate' },
  )

const SkipBodySchema = z.object({
  reason: z.string().min(1),
  userId: UserId,
})

// PATCH body for clarify state transitions. Currently the only legal
// transition the skill drives is `answered → applied`. proposalId is
// optional: present when a Proposal was produced, absent when the
// chosen candidate had no graph impact (skill records the ticket as
// applied without a linking proposal).
const ApplyBodySchema = z.object({
  status: z.literal('applied'),
  proposalId: ProposalId.optional(),
  userId: UserId,
})

// Skill-emitted candidates ship their own ids (`cc-1`, `cc-merge`, …);
// human-authored ones via Studio's "New question" form omit them and
// let the server mint via `newClarifyCandidateId`. Keeps the ID
// minting rule (no `crypto.randomUUID() as XxxId` in clients) intact.
const CreateBodySchema = ClarifyDraft
  .omit({ workspaceId: true })
  .extend({ candidates: z.array(ClarifyCandidate.partial({ id: true })) })

export interface ClarifyRouterDeps {
  hitlService: HITLService
  clarifyRepository: ClarifyTicketRepository
  decisionRepository: DecisionRepository
}

export function createClarifyRouter(deps: ClarifyRouterDeps): Hono {
  const router = new Hono()

  // Skill-facing create. Body is the ClarifyDraft minus workspaceId (taken
  // from the URL). Candidates' proposedOperations are NOT validated here;
  // they are validated when a user picks one via answerClarifyTicket.
  router.post('/', zValidator('json', CreateBodySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const body = context.req.valid('json')
    const candidates = body.candidates.map(c => ({
      ...c,
      id: c.id ?? newClarifyCandidateId(),
    }))
    const ticket = await deps.hitlService.submitClarifyTicket({ ...body, workspaceId, candidates })
    return context.json(ticket.toData(), 201)
  })

  router.get('/', zValidator('query', ListQuerySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { status, limit, offset } = context.req.valid('query')
    const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
    const tickets = await deps.clarifyRepository.list({ workspaceId, statuses, limit, offset })
    return context.json({ items: tickets.map(ticket => ticket.toData()) })
  })

  router.get('/:clarifyTicketId', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const ticketId = ClarifyTicketId.parse(context.req.param('clarifyTicketId'))
    const ticket = await deps.clarifyRepository.load(ticketId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', ticketId)
    const data = ticket.toData()
    // Surface the reviewer's free-text rationale alongside the ticket
    // so the UI can show it without a separate decisions fetch. The
    // text lives only on the Decision; we read the latest matching one
    // and add a projection field (`skipReason` or `answerNote`) for
    // the relevant terminal status.
    if (data.status === 'skipped') {
      const reason = await latestRationale(deps.decisionRepository, workspaceId, ticketId, 'skipClarifyTicket')
      if (reason)
        return context.json({ ...data, skipReason: reason })
    }
    else if (data.status === 'answered' || data.status === 'applied') {
      const note = await latestRationale(deps.decisionRepository, workspaceId, ticketId, 'answerClarifyTicket')
      if (note)
        return context.json({ ...data, answerNote: note })
    }
    return context.json(data)
  })

  router.post(
    '/:clarifyTicketId/answer',
    zValidator('json', AnswerBodySchema),
    async (context) => {
      const workspaceId = getWorkspaceId(context)
      const ticketId = ClarifyTicketId.parse(context.req.param('clarifyTicketId'))
      const body = context.req.valid('json')
      const ticket = await deps.clarifyRepository.load(ticketId)
      assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', ticketId)
      const selection = body.candidateId
        ? { kind: 'existing' as const, candidateId: body.candidateId }
        : { kind: 'custom' as const, description: body.customCandidate!.description }
      const decision = await deps.hitlService.answerClarifyTicket({
        clarifyTicketId: ticketId,
        selection,
        userId: body.userId,
        ...(body.note ? { note: body.note } : {}),
      })
      return context.json(decision)
    },
  )

  // Skill-facing: the braid-clarify skill calls this once it has
  // finished processing an `answered` ticket. Transitions the ticket
  // `answered → applied`. proposalId is optional: present when the
  // resolution was wrapped into a Proposal, absent for no-impact
  // candidates. No graph mutation happens here; the Proposal apply
  // (when there is one) already covered that.
  router.patch(
    '/:clarifyTicketId',
    zValidator('json', ApplyBodySchema),
    async (context) => {
      const workspaceId = getWorkspaceId(context)
      const ticketId = ClarifyTicketId.parse(context.req.param('clarifyTicketId'))
      const { proposalId, userId } = context.req.valid('json')
      const ticket = await deps.clarifyRepository.load(ticketId)
      assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', ticketId)
      const decision = await deps.hitlService.markClarifyTicketApplied(ticketId, userId, proposalId)
      return context.json(decision)
    },
  )

  router.post(
    '/:clarifyTicketId/skip',
    zValidator('json', SkipBodySchema),
    async (context) => {
      const workspaceId = getWorkspaceId(context)
      const ticketId = ClarifyTicketId.parse(context.req.param('clarifyTicketId'))
      const { reason, userId } = context.req.valid('json')
      const ticket = await deps.clarifyRepository.load(ticketId)
      assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', ticketId)
      const decision = await deps.hitlService.skipClarifyTicket(ticketId, reason, userId)
      return context.json(decision)
    },
  )

  return router
}
