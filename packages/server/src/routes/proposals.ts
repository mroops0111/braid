import type { HITLService, ModelRepository, ProposalRepository, ValidationService } from '@telos/core'
import { zValidator } from '@hono/zod-validator'
import { ProposalId, ProposalStatus, UserId, WorkspaceId } from '@telos/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { assertEntityInWorkspace } from './helpers.js'

const ListQuerySchema = z.object({
  status: z.union([ProposalStatus, z.array(ProposalStatus)]).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})

const ApplyBodySchema = z.object({
  userId: UserId,
})

const RejectBodySchema = z.object({
  reason: z.string().min(1),
  userId: UserId,
})

export interface ProposalsRouterDeps {
  hitlService: HITLService
  proposalRepository: ProposalRepository
  modelRepository: ModelRepository
  validationService: ValidationService
}

export function createProposalsRouter(deps: ProposalsRouterDeps): Hono {
  const router = new Hono()

  router.get('/', zValidator('query', ListQuerySchema), async (context) => {
    const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
    const { status, limit, offset } = context.req.valid('query')
    const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
    const proposals = await deps.proposalRepository.list({ workspaceId, statuses, limit, offset })
    return context.json({ items: proposals.map(proposal => proposal.toData()) })
  })

  router.get('/:proposalId', async (context) => {
    const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
    const proposalId = ProposalId.parse(context.req.param('proposalId'))
    const proposal = await deps.proposalRepository.load(proposalId)
    assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
    return context.json(proposal.toData())
  })

  // Pre-apply check: returns the validation issues a skill would hit if it
  // tried to apply this proposal right now. Skills call this after writing
  // their proposal so they can iterate on issues without the user in the loop.
  router.get('/:proposalId/validate', async (context) => {
    const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
    const proposalId = ProposalId.parse(context.req.param('proposalId'))
    const proposal = await deps.proposalRepository.load(proposalId)
    assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
    const snapshot = await deps.modelRepository.load(workspaceId)
    const result = await deps.validationService.validateOperations(snapshot, proposal.operations)
    return context.json(result)
  })

  router.post(
    '/:proposalId/apply',
    zValidator('json', ApplyBodySchema),
    async (context) => {
      const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
      const proposalId = ProposalId.parse(context.req.param('proposalId'))
      const { userId } = context.req.valid('json')
      const proposal = await deps.proposalRepository.load(proposalId)
      assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
      const decision = await deps.hitlService.applyProposal(proposalId, userId)
      return context.json(decision)
    },
  )

  router.post(
    '/:proposalId/reject',
    zValidator('json', RejectBodySchema),
    async (context) => {
      const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
      const proposalId = ProposalId.parse(context.req.param('proposalId'))
      const { reason, userId } = context.req.valid('json')
      const proposal = await deps.proposalRepository.load(proposalId)
      assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
      const decision = await deps.hitlService.rejectProposal(proposalId, reason, userId)
      return context.json(decision)
    },
  )

  return router
}
