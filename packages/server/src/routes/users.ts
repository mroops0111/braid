import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import { ForbiddenError, NotFoundError } from '@braidhq/core'
import { User, UserId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getUserId } from '../middleware/auth.js'
import { ForbiddenResponse, NotFoundResponse } from './_shared.js'

const UserIdParam = z.object({
  userId: UserId.openapi({ param: { name: 'userId', in: 'path' } }),
})

const UserListResponse = z.object({
  items: z.array(User),
}).openapi('UserListResponse')

// Self-service profile edit, only the display name.
// Server-role changes go through the admin-gated `/admin/users` routes.
const SelfProfileUpdate = z.object({
  displayName: z.string().min(1),
})

export interface UsersRouterDeps {
  userRegistry: UserRegistryFile
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

const updateUserRoute = createRoute({
  method: 'patch',
  path: '/{userId}',
  operationId: 'updateUser',
  summary: 'Update your own display name, role changes go through /admin.',
  tags: ['users'],
  request: {
    params: UserIdParam,
    body: { content: { 'application/json': { schema: SelfProfileUpdate } } },
  },
  responses: {
    200: {
      description: 'The updated user.',
      content: { 'application/json': { schema: User } },
    },
    403: ForbiddenResponse,
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

  router.openapi(updateUserRoute, async (context) => {
    const { userId } = context.req.valid('param')
    // Self-service only. Server-admin edits go through the admin routes.
    if (userId !== getUserId(context))
      throw new ForbiddenError('You can only update your own profile.')
    const patch = context.req.valid('json')
    const updated = await deps.userRegistry.update(userId, patch)
    return context.json(updated, 200)
  })

  return router
}
