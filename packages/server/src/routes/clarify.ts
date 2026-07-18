import type { ClarifyTicketRepository, HITLService } from '@braidhq/core'
import { newClarifyCandidateId } from '@braidhq/core'
import { ClarifyCandidateId, ClarifyCreateBody, ClarifyStatus, ClarifyTicket, ClarifyTicketId, ProposalId, UserId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getUserId } from '../middleware/userId.js'
import { getViewerContext, requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'
import { assertEntityInWorkspace } from './helpers.js'

const ListQuery = z.object({
  status: z.union([ClarifyStatus, z.array(ClarifyStatus)]).optional().openapi({ description: 'Filter by ticket status; pass one or many.' }),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  showAll: z.coerce.boolean().optional().openapi({ description: 'Owner-only: bypass the personal-pending filter so every member\'s open questions are visible.' }),
})

// Reviewer-facing answer body.
// The selection is either an existing `candidateId`,
// or a freshly authored `customCandidate` (description only).
// The server appends it to the ticket and answers in one transaction.
// `note` is a free-text rationale saved on the answer commit.
// `userId` is accepted for backwards compat,
// the authoritative value is the request context set by middleware.
const AnswerBody = z
  .object({
    candidateId: ClarifyCandidateId.optional(),
    customCandidate: z.object({ description: z.string().min(1) }).optional(),
    userId: UserId.optional(),
    note: z.string().min(1).optional(),
  })
  .refine(
    body => Boolean(body.candidateId) !== Boolean(body.customCandidate),
    { message: 'Provide exactly one of candidateId or customCandidate' },
  )
  .openapi('ClarifyAnswerBody')

const SkipBody = z.object({
  reason: z.string().min(1),
  userId: UserId.optional(),
}).openapi('ClarifySkipBody')

// PATCH body for clarify state transitions.
// The only legal transition the skill drives is `answered` to `applied`.
// proposalId is optional, present when a Proposal was produced,
// absent when the chosen candidate had no graph impact.
// The skill then records the ticket as applied without a linking proposal.
const ApplyBody = z.object({
  status: z.literal('applied'),
  proposalId: ProposalId.optional(),
  userId: UserId.optional(),
}).openapi('ClarifyApplyBody')

// Skill-emitted candidates ship their own ids (`cc-1`, `cc-merge`).
// Human-authored ones via Studio's "New question" form omit them,
// letting the server mint via `newClarifyCandidateId`.
// This keeps the ID minting rule intact,
// no `crypto.randomUUID() as XxxId` in clients.
const CreateBody = ClarifyCreateBody.openapi('ClarifyCreateBody')

const ClarifyTicketIdParam = WorkspaceIdParam.extend({
  clarifyTicketId: ClarifyTicketId.openapi({ param: { name: 'clarifyTicketId', in: 'path' } }),
})

const ClarifyListResponse = z.object({
  items: z.array(ClarifyTicket),
}).openapi('ClarifyListResponse')

export interface ClarifyRouterDeps {
  hitlService: HITLService
  clarifyRepository: ClarifyTicketRepository
}

const createClarifyRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createClarifyTicket',
  summary: 'Create a clarify ticket. Skills submit this when they cannot decide between candidate interpretations.',
  tags: ['clarify'],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: CreateBody } } },
  },
  responses: {
    201: {
      description: 'The saved clarify ticket.',
      content: { 'application/json': { schema: ClarifyTicket } },
    },
    400: ValidationFailureResponse,
  },
})

const listClarifyRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listClarifyTickets',
  summary: 'List clarify tickets for a workspace, optionally filtered by status.',
  tags: ['clarify'],
  request: {
    params: WorkspaceIdParam,
    query: ListQuery,
  },
  responses: {
    200: {
      description: 'A page of matching clarify tickets.',
      content: { 'application/json': { schema: ClarifyListResponse } },
    },
  },
})

const getClarifyRoute = createRoute({
  method: 'get',
  path: '/{clarifyTicketId}',
  operationId: 'getClarifyTicket',
  summary: 'Fetch a single clarify ticket.',
  tags: ['clarify'],
  request: { params: ClarifyTicketIdParam },
  responses: {
    200: {
      description: 'The requested ticket.',
      content: { 'application/json': { schema: ClarifyTicket } },
    },
    404: NotFoundResponse,
  },
})

const answerClarifyRoute = createRoute({
  method: 'post',
  path: '/{clarifyTicketId}/answer',
  operationId: 'answerClarifyTicket',
  summary: 'Reviewer answers a clarify ticket. Triggers `pending → answered` transition.',
  tags: ['clarify'],
  request: {
    params: ClarifyTicketIdParam,
    body: { content: { 'application/json': { schema: AnswerBody } } },
  },
  responses: {
    200: {
      description: 'The updated ticket.',
      content: { 'application/json': { schema: ClarifyTicket } },
    },
    404: NotFoundResponse,
  },
})

const applyClarifyRoute = createRoute({
  method: 'patch',
  path: '/{clarifyTicketId}',
  operationId: 'markClarifyTicketApplied',
  summary: 'Mark a clarify ticket applied. Optionally link the materialised Proposal.',
  description: 'Called by the braid-clarify skill once it has wrapped the resolution into a Proposal (or determined there is no graph impact). Transitions `answered → applied`.',
  tags: ['clarify'],
  request: {
    params: ClarifyTicketIdParam,
    body: { content: { 'application/json': { schema: ApplyBody } } },
  },
  responses: {
    200: {
      description: 'The updated ticket.',
      content: { 'application/json': { schema: ClarifyTicket } },
    },
    404: NotFoundResponse,
  },
})

const skipClarifyRoute = createRoute({
  method: 'post',
  path: '/{clarifyTicketId}/skip',
  operationId: 'skipClarifyTicket',
  summary: 'Skip a clarify ticket with a reason. Triggers `pending → skipped` transition.',
  tags: ['clarify'],
  request: {
    params: ClarifyTicketIdParam,
    body: { content: { 'application/json': { schema: SkipBody } } },
  },
  responses: {
    200: {
      description: 'The updated ticket.',
      content: { 'application/json': { schema: ClarifyTicket } },
    },
    404: NotFoundResponse,
  },
})

export function createClarifyRouter(deps: ClarifyRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()
  // Answer, skip, and mark-applied are HITL decisions,
  // Owner and Maintainer only.
  // Guests never see the tab, but a direct curl still 403s here.
  router.use('/:clarifyTicketId/answer', requirePermission('clarify.write'))
  router.use('/:clarifyTicketId/skip', requirePermission('clarify.write'))
  router.use('/:clarifyTicketId', requirePermission('clarify.write'))

  router.openapi(createClarifyRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const body = context.req.valid('json')
    const submitterId = getUserId(context)
    const candidates = body.candidates.map(c => ({
      ...c,
      id: c.id ?? newClarifyCandidateId(),
    }))
    const ticket = await deps.hitlService.submitClarifyTicket({ ...body, workspaceId, candidates, submitterId })
    return context.json(ticket.toData(), 201)
  })

  router.openapi(listClarifyRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { status, limit, offset, showAll } = context.req.valid('query')
    const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
    const viewer = getViewerContext(context)
    const viewerId = (showAll && viewer?.effectiveRole === 'owner') ? undefined : getUserId(context)
    const tickets = await deps.clarifyRepository.list({
      workspaceId,
      statuses,
      limit,
      offset,
      ...(viewerId ? { viewerId } : {}),
    })
    return context.json({ items: tickets.map(ticket => ticket.toData()) }, 200)
  })

  router.openapi(getClarifyRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { clarifyTicketId } = context.req.valid('param')
    const ticket = await deps.clarifyRepository.load(clarifyTicketId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', clarifyTicketId)
    return context.json(ticket.toData(), 200)
  })

  router.openapi(answerClarifyRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { clarifyTicketId } = context.req.valid('param')
    const body = context.req.valid('json')
    const userId = body.userId ?? getUserId(context)
    const ticket = await deps.clarifyRepository.load(clarifyTicketId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', clarifyTicketId)
    const selection = body.candidateId
      ? { kind: 'existing' as const, candidateId: body.candidateId }
      : { kind: 'custom' as const, description: body.customCandidate!.description }
    const answered = await deps.hitlService.answerClarifyTicket({
      clarifyTicketId,
      selection,
      userId,
      ...(body.note ? { note: body.note } : {}),
    })
    return context.json(answered.toData(), 200)
  })

  router.openapi(applyClarifyRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { clarifyTicketId } = context.req.valid('param')
    const { proposalId, userId: bodyUserId } = context.req.valid('json')
    const userId = bodyUserId ?? getUserId(context)
    const ticket = await deps.clarifyRepository.load(clarifyTicketId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', clarifyTicketId)
    const applied = await deps.hitlService.markClarifyTicketApplied(clarifyTicketId, userId, proposalId)
    return context.json(applied.toData(), 200)
  })

  router.openapi(skipClarifyRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { clarifyTicketId } = context.req.valid('param')
    const { reason, userId: bodyUserId } = context.req.valid('json')
    const userId = bodyUserId ?? getUserId(context)
    const ticket = await deps.clarifyRepository.load(clarifyTicketId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', clarifyTicketId)
    const skipped = await deps.hitlService.skipClarifyTicket(clarifyTicketId, reason, userId)
    return context.json(skipped.toData(), 200)
  })

  return router
}
