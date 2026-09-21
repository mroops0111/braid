import type { HITLService, ModelRepository, ModelValidationService, Proposal as ProposalEntity, ProposalRepository, WorkspaceService } from '@braidhq/core'
import type { Context } from 'hono'
import type { RunOutputGate } from '../infrastructure/skill/RunOutputGate.js'
import { handoffVisibleTo, NotFoundError } from '@braidhq/core'
import { Proposal, ProposalCreate, ProposalId, ProposalStatus, UserId, ValidationResult } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getSkillRunId, getUserId } from '../middleware/auth.js'
import { getViewerContext, requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { defaultPermissionRegistry } from '../policy/index.js'
import { forRuns, NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'
import { assertEntityInWorkspace } from './helpers.js'

const ListQuery = z.object({
  status: z.union([ProposalStatus, z.array(ProposalStatus)]).optional().openapi({ description: 'Filter by proposal status. Pass one or many.' }),
  limit: z.coerce.number().int().positive().optional().describe('How many to return at most, newest first. Absent returns the server\'s own page size.'),
  offset: z.coerce.number().int().nonnegative().optional().describe('How many to skip before returning any, for reading past the first page.'),
  showAll: z.coerce.boolean().optional().openapi({ description: 'Requires workspace.manage: drop the personal filter, so every member\'s unsettled work is visible.' }),
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
// `skillRunId` is not here on purpose.
// A running skill is identified by the credential it calls with,
// and a person filing a proposal has no run,
// so there is nobody left for the field to come from.
const CreateBody = ProposalCreate.omit({ workspaceId: true, skillRunId: true }).openapi('ProposalCreateBody')

const ProposalIdParam = WorkspaceIdParam.extend({
  proposalId: ProposalId.openapi({ param: { name: 'proposalId', in: 'path' } }),
})

const ProposalListResponse = z.object({
  items: z.array(Proposal),
}).openapi('ProposalListResponse')

export interface ProposalsRouterDeps {
  hitlService: HITLService
  /**
   * Holds a run to one outcome, a question or a proposal.
   * Absent, nothing is gated,
   * which is what an in-memory composition without skills wants.
   */
  outputGate?: RunOutputGate
  proposalRepository: ProposalRepository
  modelRepository: ModelRepository
  modelValidationService: ModelValidationService
  workspaceService: WorkspaceService
}

const createProposalRoute = createRoute(forRuns({
  method: 'post',
  path: '/',
  operationId: 'createProposal',
  summary: 'Submit a proposal draft. Server validates operations against the live graph.',
  description: 'Nothing in the graph changes here. A proposal waits for a person, who applies every operation in it or none. The operations are checked against the live graph on the way in, so an operation that could not apply comes back as a 400 carrying the issues rather than being stored.',
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
}, ['build']))

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

const applyProposalRoute = createRoute(forRuns({
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
}, []))

const rejectProposalRoute = createRoute(forRuns({
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
}, []))

export function createProposalsRouter(deps: ProposalsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()
  // Reading the queue is the Build surface's lower half, gated as one resource.
  // Creating is a run handing something over, carried by its own run token,
  // so it stays outside the gate a person passes.
  router.on('GET', ['/', '/:proposalId', '/:proposalId/validate'], requirePermission('handoff.read'))
  // Apply and reject settle a handoff, Owner and Maintainer only.
  // Guests never see the buttons, so this is what makes a direct curl 403.
  router.use('/:proposalId/apply', requirePermission('handoff.write'))
  router.use('/:proposalId/reject', requirePermission('handoff.write'))

  /** Whether this caller sees every member's work, rather than only their own. */
  function seesEveryone(context: Context): boolean {
    const viewer = getViewerContext(context)
    return viewer !== undefined && defaultPermissionRegistry.can('workspace.manage', viewer)
  }

  /**
   * Refuse a proposal that belongs to somebody else.
   *
   * Reported as absent rather than forbidden,
   * so the answer never confirms that another person's proposal exists.
   */
  function requireVisible(context: Context, proposal: ProposalEntity): void {
    if (!getViewerContext(context) || seesEveryone(context))
      return
    if (!handoffVisibleTo(proposal.toData(), getUserId(context)))
      throw new NotFoundError(`Proposal "${proposal.id}" not found`)
  }

  router.openapi(createProposalRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const body = context.req.valid('json')
    const submitterId = getUserId(context)
    const skillRunId = getSkillRunId(context)
    deps.outputGate?.assertMayPropose(skillRunId)
    const proposal = await deps.hitlService.submitProposal({
      workspaceId,
      ...body,
      ...(skillRunId ? { skillRunId } : {}),
      submitterId,
    })
    return context.json(proposal.toData(), 201)
  })

  router.openapi(listProposalsRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { status, limit, offset, showAll } = context.req.valid('query')
    const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
    // Show All is the one way to read another person's unsettled work,
    // so everyone else is narrowed whatever they send.
    // No viewer is an open composition (in-memory), which narrows nothing.
    const viewerId = (!getViewerContext(context) || (showAll && seesEveryone(context)))
      ? undefined
      : getUserId(context)
    const proposals = await deps.proposalRepository.list({
      workspaceId,
      statuses,
      limit,
      offset,
      ...(viewerId ? { viewerId } : {}),
    })
    return context.json({ items: proposals.map(proposal => proposal.toData()) }, 200)
  })

  router.openapi(getProposalRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { proposalId } = context.req.valid('param')
    const proposal = await deps.proposalRepository.load(proposalId)
    assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
    requireVisible(context, proposal)
    return context.json(proposal.toData(), 200)
  })

  router.openapi(validateProposalRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { proposalId } = context.req.valid('param')
    const proposal = await deps.proposalRepository.load(proposalId)
    assertEntityInWorkspace(workspaceId, proposal.workspaceId, 'Proposal', proposalId)
    requireVisible(context, proposal)
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
    requireVisible(context, proposal)
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
    requireVisible(context, proposal)
    const rejected = await deps.hitlService.rejectProposal(proposalId, reason, userId)
    return context.json(rejected.toData(), 200)
  })

  return router
}
