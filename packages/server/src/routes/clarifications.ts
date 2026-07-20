import type { ClarificationRepository, HITLService } from '@braidhq/core'
import { newClarificationCandidateId } from '@braidhq/core'
import { Clarification, ClarificationCandidateId, ClarificationCreateBody, ClarificationId, ClarificationStatus, ProposalId, UserId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getUserId } from '../middleware/userId.js'
import { getViewerContext, requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'
import { assertEntityInWorkspace } from './helpers.js'

const ListQuery = z.object({
  status: z.union([ClarificationStatus, z.array(ClarificationStatus)]).optional().openapi({ description: 'Filter by ticket status. Pass one or many.' }),
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
    candidateId: ClarificationCandidateId.optional(),
    customCandidate: z.object({ description: z.string().min(1) }).optional(),
    userId: UserId.optional(),
    note: z.string().min(1).optional(),
  })
  .refine(
    body => Boolean(body.candidateId) !== Boolean(body.customCandidate),
    { message: 'Provide exactly one of candidateId or customCandidate' },
  )
  .openapi('ClarificationAnswerBody')

const SkipBody = z.object({
  reason: z.string().min(1),
  userId: UserId.optional(),
}).openapi('ClarificationSkipBody')

// PATCH body for clarification state transitions.
// The only legal transition the skill drives is `answered` to `applied`.
// proposalId is optional, present when a Proposal was produced,
// absent when the chosen candidate had no graph impact.
// The skill then records the ticket as applied without a linking proposal.
const ApplyBody = z.object({
  status: z.literal('applied'),
  proposalId: ProposalId.optional(),
  userId: UserId.optional(),
}).openapi('ClarificationApplyBody')

// Skill-emitted candidates ship their own ids (`cc-1`, `cc-merge`).
// Human-authored ones via Studio's "New question" form omit them,
// letting the server mint via `newClarificationCandidateId`.
// This keeps the ID minting rule intact,
// no `crypto.randomUUID() as XxxId` in clients.
const CreateBody = ClarificationCreateBody.openapi('ClarificationCreateBody')

const ClarificationIdParam = WorkspaceIdParam.extend({
  clarificationId: ClarificationId.openapi({ param: { name: 'clarificationId', in: 'path' } }),
})

const ClarificationListResponse = z.object({
  items: z.array(Clarification),
}).openapi('ClarificationListResponse')

export interface ClarificationRouterDeps {
  hitlService: HITLService
  clarificationRepository: ClarificationRepository
}

const createClarificationRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createClarification',
  summary: 'Create a clarification. Skills submit this when they cannot decide between candidate interpretations.',
  tags: ['clarify'],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: CreateBody } } },
  },
  responses: {
    201: {
      description: 'The saved clarification.',
      content: { 'application/json': { schema: Clarification } },
    },
    400: ValidationFailureResponse,
  },
})

const listClarificationRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listClarifications',
  summary: 'List clarifications for a workspace, optionally filtered by status.',
  tags: ['clarify'],
  request: {
    params: WorkspaceIdParam,
    query: ListQuery,
  },
  responses: {
    200: {
      description: 'A page of matching clarifications.',
      content: { 'application/json': { schema: ClarificationListResponse } },
    },
  },
})

const getClarificationRoute = createRoute({
  method: 'get',
  path: '/{clarificationId}',
  operationId: 'getClarification',
  summary: 'Fetch a single clarification.',
  tags: ['clarify'],
  request: { params: ClarificationIdParam },
  responses: {
    200: {
      description: 'The requested ticket.',
      content: { 'application/json': { schema: Clarification } },
    },
    404: NotFoundResponse,
  },
})

const answerClarificationRoute = createRoute({
  method: 'post',
  path: '/{clarificationId}/answer',
  operationId: 'answerClarification',
  summary: 'Reviewer answers a clarification. Triggers `pending → answered` transition.',
  tags: ['clarify'],
  request: {
    params: ClarificationIdParam,
    body: { content: { 'application/json': { schema: AnswerBody } } },
  },
  responses: {
    200: {
      description: 'The updated ticket.',
      content: { 'application/json': { schema: Clarification } },
    },
    404: NotFoundResponse,
  },
})

const applyClarificationRoute = createRoute({
  method: 'patch',
  path: '/{clarificationId}',
  operationId: 'markClarificationApplied',
  summary: 'Mark a clarification applied. Optionally link the materialised Proposal.',
  description: 'Called by the braid-clarify skill once it has wrapped the resolution into a Proposal (or determined there is no graph impact). Transitions `answered → applied`.',
  tags: ['clarify'],
  request: {
    params: ClarificationIdParam,
    body: { content: { 'application/json': { schema: ApplyBody } } },
  },
  responses: {
    200: {
      description: 'The updated ticket.',
      content: { 'application/json': { schema: Clarification } },
    },
    404: NotFoundResponse,
  },
})

const skipClarificationRoute = createRoute({
  method: 'post',
  path: '/{clarificationId}/skip',
  operationId: 'skipClarification',
  summary: 'Skip a clarification with a reason. Triggers `pending → skipped` transition.',
  tags: ['clarify'],
  request: {
    params: ClarificationIdParam,
    body: { content: { 'application/json': { schema: SkipBody } } },
  },
  responses: {
    200: {
      description: 'The updated ticket.',
      content: { 'application/json': { schema: Clarification } },
    },
    404: NotFoundResponse,
  },
})

export function createClarificationRouter(deps: ClarificationRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()
  // Answer, skip, and mark-applied are HITL decisions,
  // Owner and Maintainer only.
  // Guests never see the tab, but a direct curl still 403s here.
  router.use('/:clarificationId/answer', requirePermission('clarification.write'))
  router.use('/:clarificationId/skip', requirePermission('clarification.write'))
  router.use('/:clarificationId', requirePermission('clarification.write'))

  router.openapi(createClarificationRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const body = context.req.valid('json')
    const submitterId = getUserId(context)
    const candidates = body.candidates.map(c => ({
      ...c,
      id: c.id ?? newClarificationCandidateId(),
    }))
    const ticket = await deps.hitlService.submitClarification({ ...body, workspaceId, candidates, submitterId })
    return context.json(ticket.toData(), 201)
  })

  router.openapi(listClarificationRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { status, limit, offset, showAll } = context.req.valid('query')
    const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
    const viewer = getViewerContext(context)
    const viewerId = (showAll && viewer?.effectiveRole === 'owner') ? undefined : getUserId(context)
    const tickets = await deps.clarificationRepository.list({
      workspaceId,
      statuses,
      limit,
      offset,
      ...(viewerId ? { viewerId } : {}),
    })
    return context.json({ items: tickets.map(ticket => ticket.toData()) }, 200)
  })

  router.openapi(getClarificationRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { clarificationId } = context.req.valid('param')
    const ticket = await deps.clarificationRepository.load(clarificationId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'Clarification', clarificationId)
    return context.json(ticket.toData(), 200)
  })

  router.openapi(answerClarificationRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { clarificationId } = context.req.valid('param')
    const body = context.req.valid('json')
    const userId = body.userId ?? getUserId(context)
    const ticket = await deps.clarificationRepository.load(clarificationId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'Clarification', clarificationId)
    const selection = body.candidateId
      ? { kind: 'existing' as const, candidateId: body.candidateId }
      : { kind: 'custom' as const, description: body.customCandidate!.description }
    const answered = await deps.hitlService.answerClarification({
      clarificationId,
      selection,
      userId,
      ...(body.note ? { note: body.note } : {}),
    })
    return context.json(answered.toData(), 200)
  })

  router.openapi(applyClarificationRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { clarificationId } = context.req.valid('param')
    const { proposalId, userId: bodyUserId } = context.req.valid('json')
    const userId = bodyUserId ?? getUserId(context)
    const ticket = await deps.clarificationRepository.load(clarificationId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'Clarification', clarificationId)
    const applied = await deps.hitlService.markClarificationApplied(clarificationId, userId, proposalId)
    return context.json(applied.toData(), 200)
  })

  router.openapi(skipClarificationRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { clarificationId } = context.req.valid('param')
    const { reason, userId: bodyUserId } = context.req.valid('json')
    const userId = bodyUserId ?? getUserId(context)
    const ticket = await deps.clarificationRepository.load(clarificationId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'Clarification', clarificationId)
    const skipped = await deps.hitlService.skipClarification(clarificationId, reason, userId)
    return context.json(skipped.toData(), 200)
  })

  return router
}
