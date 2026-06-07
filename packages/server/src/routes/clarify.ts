import type { ClarifyTicketRepository, DecisionRepository, HITLService } from '@braidhq/core'
import type { ClarifyTicketId as ClarifyTicketIdType, DecisionAction, WorkspaceId } from '@braidhq/schema'
import { newClarifyCandidateId } from '@braidhq/core'
import { ClarifyCandidate, ClarifyCandidateId, ClarifyDraft, ClarifyStatus, ClarifyTicket, ClarifyTicketId, Decision, ProposalId, UserId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getUserId } from '../middleware/userId.js'
import { getViewerContext, requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'
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

const ListQuery = z.object({
  status: z.union([ClarifyStatus, z.array(ClarifyStatus)]).optional().openapi({ description: 'Filter by ticket status; pass one or many.' }),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  showAll: z.coerce.boolean().optional().openapi({ description: 'Owner-only: bypass the personal-pending filter so every member\'s open questions are visible.' }),
})

// Reviewer-facing answer body. The selection is either an existing
// `candidateId` or a freshly authored `customCandidate` (description
// only — the server appends it to the ticket and answers in one
// transaction). `note` is a free-text rationale that survives on the
// Decision log; the GET projection surfaces it back as `answerNote`.
// `userId` accepted for backwards compat; authoritative value is the
// request context (set by `userIdMiddleware`).
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

// PATCH body for clarify state transitions. Currently the only legal
// transition the skill drives is `answered → applied`. proposalId is
// optional: present when a Proposal was produced, absent when the
// chosen candidate had no graph impact (skill records the ticket as
// applied without a linking proposal).
const ApplyBody = z.object({
  status: z.literal('applied'),
  proposalId: ProposalId.optional(),
  userId: UserId.optional(),
}).openapi('ClarifyApplyBody')

// Skill-emitted candidates ship their own ids (`cc-1`, `cc-merge`, …);
// human-authored ones via Studio's "New question" form omit them and
// let the server mint via `newClarifyCandidateId`. Keeps the ID
// minting rule (no `crypto.randomUUID() as XxxId` in clients) intact.
const CreateBody = ClarifyDraft
  .omit({ workspaceId: true })
  .extend({ candidates: z.array(ClarifyCandidate.partial({ id: true })) })
  .openapi('ClarifyCreateBody')

const ClarifyTicketIdParam = WorkspaceIdParam.extend({
  clarifyTicketId: ClarifyTicketId.openapi({ param: { name: 'clarifyTicketId', in: 'path' } }),
})

const ClarifyListResponse = z.object({
  items: z.array(ClarifyTicket),
}).openapi('ClarifyListResponse')

// GET /clarify/:id may attach a projection field (`skipReason` /
// `answerNote`) when surfacing the latest Decision rationale. Either
// field shows up on top of the base ClarifyTicket shape; never both.
const ClarifyTicketWithProjection = ClarifyTicket.extend({
  skipReason: z.string().optional(),
  answerNote: z.string().optional(),
}).openapi('ClarifyTicketWithProjection')

export interface ClarifyRouterDeps {
  hitlService: HITLService
  clarifyRepository: ClarifyTicketRepository
  decisionRepository: DecisionRepository
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
  summary: 'Fetch a single clarify ticket. May include `skipReason` / `answerNote` projection when terminal.',
  tags: ['clarify'],
  request: { params: ClarifyTicketIdParam },
  responses: {
    200: {
      description: 'The requested ticket (optionally with skipReason / answerNote projection).',
      content: { 'application/json': { schema: ClarifyTicketWithProjection } },
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
      description: 'The recorded Decision.',
      content: { 'application/json': { schema: Decision } },
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
      description: 'The recorded Decision.',
      content: { 'application/json': { schema: Decision } },
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
      description: 'The recorded Decision.',
      content: { 'application/json': { schema: Decision } },
    },
    404: NotFoundResponse,
  },
})

export function createClarifyRouter(deps: ClarifyRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()
  // Answer / skip / mark-applied are HITL decisions — Owner + Maintainer
  // only. Guests never see the tab but a direct curl still 403s here.
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
    const data = ticket.toData()
    // Surface the reviewer's free-text rationale alongside the ticket
    // so the UI can show it without a separate decisions fetch. The
    // text lives only on the Decision; we read the latest matching one
    // and add a projection field (`skipReason` or `answerNote`) for
    // the relevant terminal status.
    if (data.status === 'skipped') {
      const reason = await latestRationale(deps.decisionRepository, workspaceId, clarifyTicketId, 'skipClarifyTicket')
      if (reason)
        return context.json({ ...data, skipReason: reason }, 200)
    }
    else if (data.status === 'answered' || data.status === 'applied') {
      const note = await latestRationale(deps.decisionRepository, workspaceId, clarifyTicketId, 'answerClarifyTicket')
      if (note)
        return context.json({ ...data, answerNote: note }, 200)
    }
    return context.json(data, 200)
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
    const decision = await deps.hitlService.answerClarifyTicket({
      clarifyTicketId,
      selection,
      userId,
      ...(body.note ? { note: body.note } : {}),
    })
    return context.json(decision, 200)
  })

  router.openapi(applyClarifyRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { clarifyTicketId } = context.req.valid('param')
    const { proposalId, userId: bodyUserId } = context.req.valid('json')
    const userId = bodyUserId ?? getUserId(context)
    const ticket = await deps.clarifyRepository.load(clarifyTicketId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', clarifyTicketId)
    const decision = await deps.hitlService.markClarifyTicketApplied(clarifyTicketId, userId, proposalId)
    return context.json(decision, 200)
  })

  router.openapi(skipClarifyRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { clarifyTicketId } = context.req.valid('param')
    const { reason, userId: bodyUserId } = context.req.valid('json')
    const userId = bodyUserId ?? getUserId(context)
    const ticket = await deps.clarifyRepository.load(clarifyTicketId)
    assertEntityInWorkspace(workspaceId, ticket.workspaceId, 'ClarifyTicket', clarifyTicketId)
    const decision = await deps.hitlService.skipClarifyTicket(clarifyTicketId, reason, userId)
    return context.json(decision, 200)
  })

  return router
}
