import type { ClarifyTicketRepository, HITLService } from '@telos/core'
import { zValidator } from '@hono/zod-validator'
import { ClarifyCandidateId, ClarifyDraft, ClarifyStatus, ClarifyTicketId, ProposalId, UserId } from '@telos/schema'
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

const LinkProposalBodySchema = z.object({
  proposalId: ProposalId,
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

  // Skill-facing: the telos-clarify skill calls this once it has wrapped
  // an `answered` ticket's resolution into a Proposal. Transitions the
  // ticket `answered → applied` and stamps the linking proposalId so the
  // UI can navigate from a ticket back to its Proposal. No graph
  // mutation happens here; the Proposal apply already covered that.
  router.patch(
    '/:clarifyTicketId',
    zValidator('json', LinkProposalBodySchema),
    async (context) => {
      const workspaceId = getWorkspaceId(context)
      const ticketId = ClarifyTicketId.parse(context.req.param('clarifyTicketId'))
      const { proposalId, userId } = context.req.valid('json')
      const ticket = await deps.clarifyRepository.load(ticketId)
      assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', ticketId)
      const decision = await deps.hitlService.linkClarifyTicketToProposal(ticketId, proposalId, userId)
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
