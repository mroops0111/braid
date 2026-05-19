import type { HITLService, ModelRepository, ProposalRepository, ValidationService, WorkspaceService } from '@braidhq/core'
import { ProposalDraft, ProposalId, ProposalStatus, UserId } from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getWorkspaceId } from '../middleware/workspaceId.js'
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

// Skill-facing create. Body must carry `workspaceId` matching the route
// param; we let zod parse the rest of the ProposalDraft fields and let
// HITLService.submitProposal validate ops against the live graph.
const CreateBodySchema = ProposalDraft.omit({ workspaceId: true })

export interface ProposalsRouterDeps {
  hitlService: HITLService
  proposalRepository: ProposalRepository
  modelRepository: ModelRepository
  validationService: ValidationService
  workspaceService: WorkspaceService
}

export function createProposalsRouter(deps: ProposalsRouterDeps): Hono {
  const router = new Hono()

  // Create. Returns 201 + the saved proposal on success, 400 + `issues`
  // when ops fail validation. Skills call this instead of writing JSON files
  // so they pick up validation errors on the write call, not on apply.
  router.post('/', zValidator('json', CreateBodySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const body = context.req.valid('json')
    const proposal = await deps.hitlService.submitProposal({ workspaceId, ...body })
    return context.json(proposal.toData(), 201)
  })

  router.get('/', zValidator('query', ListQuerySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { status, limit, offset } = context.req.valid('query')
    const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
    const proposals = await deps.proposalRepository.list({ workspaceId, statuses, limit, offset })
    return context.json({ items: proposals.map(proposal => proposal.toData()) })
  })

  router.get('/:proposalId', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const proposalId = ProposalId.parse(context.req.param('proposalId'))
    const proposal = await deps.proposalRepository.load(proposalId)
    assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
    return context.json(proposal.toData())
  })

  // Pre-apply check: returns the validation issues a skill would hit if it
  // tried to apply this proposal right now. Skills call this after writing
  // their proposal so they can iterate on issues without the user in the loop.
  router.get('/:proposalId/validate', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const proposalId = ProposalId.parse(context.req.param('proposalId'))
    const proposal = await deps.proposalRepository.load(proposalId)
    assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
    const workspace = await deps.workspaceService.findById(workspaceId)
    const snapshot = await deps.modelRepository.load(workspaceId)
    const result = await deps.validationService.validateOperations(snapshot, proposal.operations, workspace)
    return context.json(result)
  })

  router.post(
    '/:proposalId/apply',
    zValidator('json', ApplyBodySchema),
    async (context) => {
      const workspaceId = getWorkspaceId(context)
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
      const workspaceId = getWorkspaceId(context)
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
