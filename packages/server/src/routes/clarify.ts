import type { ClarifyTicketRepository, HITLService } from '@braidhq/core'
import { ClarifyCandidateId, ClarifyDraft, ClarifyStatus, ClarifyTicketId, ProposalId, UserId } from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { assertEntityInWorkspace } from './helpers.js'

const ListQuerySchema = z.object({
  status: z.union([ClarifyStatus, z.array(ClarifyStatus)]).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})

const AnswerBodySchema = z.object({
  candidateId: ClarifyCandidateId,
  userId: UserId,
})

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

const CreateBodySchema = ClarifyDraft.omit({ workspaceId: true })

export interface ClarifyRouterDeps {
  hitlService: HITLService
  clarifyRepository: ClarifyTicketRepository
}

export function createClarifyRouter(deps: ClarifyRouterDeps): Hono {
  const router = new Hono()

  // Skill-facing create. Body is the ClarifyDraft minus workspaceId (taken
  // from the URL). Candidates' proposedOperations are NOT validated here;
  // they are validated when a user picks one via answerClarifyTicket.
  router.post('/', zValidator('json', CreateBodySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const body = context.req.valid('json')
    const ticket = await deps.hitlService.submitClarifyTicket({ workspaceId, ...body })
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
    return context.json(ticket.toData())
  })

  router.post(
    '/:clarifyTicketId/answer',
    zValidator('json', AnswerBodySchema),
    async (context) => {
      const workspaceId = getWorkspaceId(context)
      const ticketId = ClarifyTicketId.parse(context.req.param('clarifyTicketId'))
      const { candidateId, userId } = context.req.valid('json')
      const ticket = await deps.clarifyRepository.load(ticketId)
      assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', ticketId)
      const decision = await deps.hitlService.answerClarifyTicket(ticketId, candidateId, userId)
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
