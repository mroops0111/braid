import type { Clock } from '@braidhq/core'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import { newUserId, NotFoundError } from '@braidhq/core'
import { User, UserDraft, UserId, UserPatch } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getUserId } from '../middleware/userId.js'
import { NotFoundResponse, ValidationFailureResponse } from './_shared.js'

const UserIdParam = z.object({
  userId: UserId.openapi({ param: { name: 'userId', in: 'path' } }),
})

const UserListResponse = z.object({
  items: z.array(User),
}).openapi('UserListResponse')

export interface UsersRouterDeps {
  userRegistry: UserRegistryFile
  clock: Clock
}

const listUsersRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listUsers',
  summary: 'List all users on this server.',
  tags: ['users'],
  responses: {
    200: {
      description: 'A list of users.',
      content: { 'application/json': { schema: UserListResponse } },
    },
  },
})

const getMeRoute = createRoute({
  method: 'get',
  path: '/me',
  operationId: 'getMe',
  summary: 'Return the user identified by the current request context.',
  tags: ['users'],
  responses: {
    200: {
      description: 'The current user.',
      content: { 'application/json': { schema: User } },
    },
    404: NotFoundResponse,
  },
})

const getUserRoute = createRoute({
  method: 'get',
  path: '/{userId}',
  operationId: 'getUser',
  summary: 'Fetch a single user by id.',
  tags: ['users'],
  request: { params: UserIdParam },
  responses: {
    200: {
      description: 'The requested user.',
      content: { 'application/json': { schema: User } },
    },
    404: NotFoundResponse,
  },
})

const createUserRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createUser',
  summary: 'Create a user. Phase A: any caller; Phase B/C will gate by Admin role.',
  tags: ['users'],
  request: {
    body: { content: { 'application/json': { schema: UserDraft } } },
  },
  responses: {
    201: {
      description: 'The created user.',
      content: { 'application/json': { schema: User } },
    },
    400: ValidationFailureResponse,
  },
})

const updateUserRoute = createRoute({
  method: 'patch',
  path: '/{userId}',
  operationId: 'updateUser',
  summary: 'Patch a user record. Phase A: any caller; Phase B/C will gate by Admin role.',
  tags: ['users'],
  request: {
    params: UserIdParam,
    body: { content: { 'application/json': { schema: UserPatch } } },
  },
  responses: {
    200: {
      description: 'The updated user.',
      content: { 'application/json': { schema: User } },
    },
    404: NotFoundResponse,
  },
})

export function createUsersRouter(deps: UsersRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listUsersRoute, async (context) => {
    const users = await deps.userRegistry.list()
    return context.json({ items: users }, 200)
  })

  router.openapi(getMeRoute, async (context) => {
    const userId = getUserId(context)
    const user = await deps.userRegistry.get(userId)
    if (!user)
      throw new NotFoundError(`Current user "${userId}" not found in registry`)
    return context.json(user, 200)
  })

  router.openapi(getUserRoute, async (context) => {
    const { userId } = context.req.valid('param')
    const user = await deps.userRegistry.get(userId)
    if (!user)
      throw new NotFoundError(`User "${userId}" not found`)
    return context.json(user, 200)
  })

  router.openapi(createUserRoute, async (context) => {
    const draft = context.req.valid('json')
    const created = await deps.userRegistry.create({
      id: newUserId(),
      ...draft,
      serverRole: draft.serverRole ?? 'user',
      canCreateWorkspace: draft.canCreateWorkspace ?? false,
      createdAt: deps.clock.now(),
    })
    return context.json(created, 201)
  })

  router.openapi(updateUserRoute, async (context) => {
    const { userId } = context.req.valid('param')
    const patch = context.req.valid('json')
    const updated = await deps.userRegistry.update(userId, patch)
    return context.json(updated, 200)
  })

  return router
}
