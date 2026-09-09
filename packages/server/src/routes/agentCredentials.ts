import type { AgentCredentialStore } from '@braidhq/core'
import type { AgentCredentialBroker } from '../infrastructure/agent/AgentCredentialBroker.js'
import { AgentCredentialSource, AgentCredentialSummary, AgentKind } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getUserId } from '../middleware/auth.js'
import { ValidationFailureResponse } from './_shared.js'

const KindParam = z.object({
  agentKind: AgentKind.openapi({ param: { name: 'agentKind', in: 'path' } }),
})

/**
 * What a run would spend, and what the caller has saved towards it.
 *
 * `credential` is absent where they have saved none,
 * and `source` then says whether the server covers them,
 * or the run would be refused.
 */
const StatusResponse = z.object({
  source: AgentCredentialSource,
  credential: AgentCredentialSummary.optional(),
}).openapi('AgentCredentialStatus')

const SaveBody = z.object({
  credential: z.string().min(1).max(4096),
})

export interface AgentCredentialsRouterDeps {
  readonly store: AgentCredentialStore
  readonly broker: AgentCredentialBroker
}

const getRoute = createRoute({
  method: 'get',
  path: '/{agentKind}',
  operationId: 'getAgentCredential',
  summary: 'What the caller has saved for this agent, and what a run would spend.',
  description: 'Never returns the credential. `hint` carries its last few characters so an owner can recognise which one they saved.',
  tags: ['agent-credentials'],
  request: { params: KindParam },
  responses: {
    200: {
      description: 'The caller\'s standing with this agent.',
      content: { 'application/json': { schema: StatusResponse } },
    },
  },
})

const putRoute = createRoute({
  method: 'put',
  path: '/{agentKind}',
  operationId: 'saveAgentCredential',
  summary: 'Save the caller\'s own credential for this agent.',
  description: 'Replaces whatever was there. The credential is encrypted at rest and no route reads it back.',
  tags: ['agent-credentials'],
  request: {
    params: KindParam,
    body: { content: { 'application/json': { schema: SaveBody } } },
  },
  responses: {
    200: {
      description: 'Saved. Answers as the GET does.',
      content: { 'application/json': { schema: StatusResponse } },
    },
    400: ValidationFailureResponse,
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{agentKind}',
  operationId: 'forgetAgentCredential',
  summary: 'Forget the caller\'s credential for this agent.',
  tags: ['agent-credentials'],
  request: { params: KindParam },
  responses: {
    200: {
      description: 'Forgotten. Answers as the GET does.',
      content: { 'application/json': { schema: StatusResponse } },
    },
  },
})

/**
 * A person's own agent credentials, and nobody else's.
 *
 * Every route acts on the caller.
 * No path carries another user's id,
 * so an admin has no route to read or replace what a colleague saved.
 * The absence is the guarantee, rather than a check somewhere.
 */
export function createAgentCredentialsRouter(deps: AgentCredentialsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  async function statusFor(
    userId: ReturnType<typeof getUserId>,
    kind: AgentKind,
  ): Promise<z.infer<typeof StatusResponse>> {
    const [stored, source] = await Promise.all([
      deps.store.describe(userId, kind),
      deps.broker.sourceFor(userId, kind),
    ])
    return {
      source,
      ...(stored ? { credential: { kind, ...stored } } : {}),
    }
  }

  router.openapi(getRoute, async (context) => {
    const { agentKind } = context.req.valid('param')
    return context.json(await statusFor(getUserId(context), agentKind), 200)
  })

  router.openapi(putRoute, async (context) => {
    const { agentKind } = context.req.valid('param')
    const userId = getUserId(context)
    await deps.store.save(userId, agentKind, context.req.valid('json').credential)
    return context.json(await statusFor(userId, agentKind), 200)
  })

  router.openapi(deleteRoute, async (context) => {
    const { agentKind } = context.req.valid('param')
    const userId = getUserId(context)
    await deps.store.forget(userId, agentKind)
    return context.json(await statusFor(userId, agentKind), 200)
  })

  return router
}
