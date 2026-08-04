import type { HITLService, ModelRepository, ModelValidationService, ProposalRepository, WorkspaceService } from '@braidhq/core'
import { Proposal, ProposalCreate, ProposalId, ProposalStatus, UserId, ValidationResult } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getUserId } from '../middleware/auth.js'
import { getViewerContext, requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'
import { assertEntityInWorkspace } from './helpers.js'

const ListQuery = z.object({
  status: z.union([ProposalStatus, z.array(ProposalStatus)]).optional().openapi({ description: 'Filter by proposal status. Pass one or many.' }),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  showAll: z.coerce.boolean().optional().openapi({ description: 'Owner-only: bypass the personal-pending filter so every member\'s drafts are visible.' }),
})

// Body `userId` is a back-compat shim.
// It serves API consumers still on neither the `X-Braid-User` header,
// nor the Bearer-token flow.
// When present it overrides the middleware-derived id.
// When omitted the handler falls back to `getUserId(c)`.
// Studio sends it via header only.
// The path will be removed once the deprecation window closes.
const ApplyBody = z.object({
  userId: UserId.optional(),
}).openapi('ProposalApplyBody')

const RejectBody = z.object({
  reason: z.string().min(1),
  userId: UserId.optional(),
}).openapi('ProposalRejectBody')

// Skill-facing create. Body must carry `workspaceId` matching the route param.
// Zod parses the rest of the ProposalCreate fields,
// and HITLService.submitProposal validates ops against the live graph.
const CreateBody = ProposalCreate.omit({ workspaceId: true }).openapi('ProposalCreateBody')

const ProposalIdParam = WorkspaceIdParam.extend({
  proposalId: ProposalId.openapi({ param: { name: 'proposalId', in: 'path' } }),
})

const ProposalListResponse = z.object({
  items: z.array(Proposal),
}).openapi('ProposalListResponse')

export interface ProposalsRouterDeps {
  hitlService: HITLService
  proposalRepository: ProposalRepository
  modelRepository: ModelRepository
  modelValidationService: ModelValidationService
  workspaceService: WorkspaceService
}

const createProposalRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createProposal',
  summary: 'Submit a proposal draft. Server validates operations against the live graph.',
  description: 'Skills POST here to submit graph operations for HITL review. Returns 201 with the saved proposal on success, 400 with structured issues on validation failure.',
  tags: ['proposals'],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: CreateBody } } },
  },
  responses: {
    201: {
      description: 'The saved proposal.',
      content: { 'application/json': { schema: Proposal } },
    },
    400: ValidationFailureResponse,
  },
})

const listProposalsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listProposals',
  summary: 'List proposals for a workspace, optionally filtered by status.',
  tags: ['proposals'],
  request: {
    params: WorkspaceIdParam,
    query: ListQuery,
  },
  responses: {
    200: {
      description: 'A page of matching proposals.',
      content: { 'application/json': { schema: ProposalListResponse } },
    },
  },
})

const getProposalRoute = createRoute({
  method: 'get',
  path: '/{proposalId}',
  operationId: 'getProposal',
  summary: 'Fetch a single proposal by id.',
  tags: ['proposals'],
  request: { params: ProposalIdParam },
  responses: {
    200: {
      description: 'The requested proposal.',
      content: { 'application/json': { schema: Proposal } },
    },
    404: NotFoundResponse,
  },
})

const validateProposalRoute = createRoute({
  method: 'get',
  path: '/{proposalId}/validate',
  operationId: 'validateProposal',
  summary: 'Pre-apply check that returns the validation issues a proposal would hit if applied now.',
  tags: ['proposals'],
  request: { params: ProposalIdParam },
  responses: {
    200: {
      description: 'Validation result for the proposal against the current graph.',
      content: { 'application/json': { schema: ValidationResult } },
    },
    404: NotFoundResponse,
  },
})

const applyProposalRoute = createRoute({
  method: 'post',
  path: '/{proposalId}/apply',
  operationId: 'applyProposal',
  summary: 'Apply a proposal to the graph. Human-triggered in the UI.',
  tags: ['proposals'],
  request: {
    params: ProposalIdParam,
    body: { content: { 'application/json': { schema: ApplyBody } } },
  },
  responses: {
    200: {
      description: 'The updated proposal.',
      content: { 'application/json': { schema: Proposal } },
    },
    404: NotFoundResponse,
  },
})

const rejectProposalRoute = createRoute({
  method: 'post',
  path: '/{proposalId}/reject',
  operationId: 'rejectProposal',
  summary: 'Reject a proposal with a rationale. Human-triggered in the UI.',
  tags: ['proposals'],
  request: {
    params: ProposalIdParam,
    body: { content: { 'application/json': { schema: RejectBody } } },
  },
  responses: {
    200: {
      description: 'The updated proposal.',
      content: { 'application/json': { schema: Proposal } },
    },
    404: NotFoundResponse,
  },
})

export function createProposalsRouter(deps: ProposalsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()
  // Apply and reject are HITL decisions, Owner and Maintainer only.
  // Guests never see the buttons, the UI hides the tab.
  // Defence-in-depth here means a direct curl from a Guest still 403s.
  router.use('/:proposalId/apply', requirePermission('proposal.write'))
  router.use('/:proposalId/reject', requirePermission('proposal.write'))

  router.openapi(createProposalRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const body = context.req.valid('json')
    const submitterId = getUserId(context)
    const proposal = await deps.hitlService.submitProposal({ workspaceId, ...body, submitterId })
    return context.json(proposal.toData(), 201)
  })

  router.openapi(listProposalsRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { status, limit, offset, showAll } = context.req.valid('query')
    const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
    // Show All bypass is gated to the workspace owner.
    // Everyone else is forced through the personal-pending filter,
    // whatever they send.
    const viewer = getViewerContext(context)
    const viewerId = (showAll && viewer?.effectiveRole === 'owner') ? undefined : getUserId(context)
    // Only owners see service-account (autonomous) pending, since only they can apply it.
    // An absent viewer is an open composition (in-memory, headless), which stays open.
    const includeServiceAccounts = !viewer || viewer.effectiveRole === 'owner'
    const proposals = await deps.proposalRepository.list({
      workspaceId,
      statuses,
      limit,
      offset,
      ...(viewerId ? { viewerId, includeServiceAccounts } : {}),
    })
    return context.json({ items: proposals.map(proposal => proposal.toData()) }, 200)
  })

  router.openapi(getProposalRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { proposalId } = context.req.valid('param')
    const proposal = await deps.proposalRepository.load(proposalId)
    assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
    return context.json(proposal.toData(), 200)
  })

  router.openapi(validateProposalRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { proposalId } = context.req.valid('param')
    const proposal = await deps.proposalRepository.load(proposalId)
    assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
    const workspace = await deps.workspaceService.findById(workspaceId)
    const snapshot = await deps.modelRepository.load(workspaceId)
    const result = await deps.modelValidationService.validateOperations(snapshot, proposal.operations, workspace)
    return context.json(result, 200)
  })

  router.openapi(applyProposalRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { proposalId } = context.req.valid('param')
    const body = context.req.valid('json')
    const userId = body.userId ?? getUserId(context)
    const proposal = await deps.proposalRepository.load(proposalId)
    assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
    const applied = await deps.hitlService.applyProposal(proposalId, userId)
    return context.json(applied.toData(), 200)
  })

  router.openapi(rejectProposalRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { proposalId } = context.req.valid('param')
    const { reason, userId: bodyUserId } = context.req.valid('json')
    const userId = bodyUserId ?? getUserId(context)
    const proposal = await deps.proposalRepository.load(proposalId)
    assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
    const rejected = await deps.hitlService.rejectProposal(proposalId, reason, userId)
    return context.json(rejected.toData(), 200)
  })

  return router
}
