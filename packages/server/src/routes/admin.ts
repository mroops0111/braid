import type { WorkspaceService } from '@braidhq/core'
import type { WorkspaceId as WorkspaceIdType, WorkspaceRole as WorkspaceRoleType } from '@braidhq/schema'
import type { AccessPolicy } from '../infrastructure/auth/AccessPolicy.js'
import type { WorkspaceRegistryFile } from '../infrastructure/fs/WorkspaceRegistryFile.js'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import { NotFoundError } from '@braidhq/core'
import { ServerRole, User, UserId, WorkspaceId, WorkspaceRole } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { getUserId } from '../middleware/userId.js'
import { NotFoundResponse, ValidationFailureResponse } from './_shared.js'

const Invite = z.object({
  email: z.string().email(),
  invitedAt: z.string().datetime({ offset: true }),
  serverRole: ServerRole,
}).openapi('Invite')

const InviteListResponse = z.object({
  items: z.array(Invite),
}).openapi('InviteListResponse')

const InviteDraft = z.object({
  email: z.string().email(),
  serverRole: ServerRole.optional(),
}).openapi('InviteDraft')

const EmailParam = z.object({
  email: z.string().email().openapi({ param: { name: 'email', in: 'path' } }),
})

const UserIdParam = z.object({
  userId: UserId.openapi({ param: { name: 'userId', in: 'path' } }),
})

const AdminUserPatch = z.object({
  serverRole: ServerRole,
}).openapi('AdminUserPatch')

const AdminUserWorkspace = z.object({
  workspaceId: WorkspaceId,
  role: WorkspaceRole,
}).openapi('AdminUserWorkspace')

const AdminUserView = User.extend({
  workspaces: z.array(AdminUserWorkspace),
}).openapi('AdminUserView')

const UserListResponse = z.object({
  items: z.array(AdminUserView),
}).openapi('AdminUserListResponse')

export interface AdminRouterDeps {
  userRegistry: UserRegistryFile
  accessPolicy: AccessPolicy
  workspaceRegistry: WorkspaceRegistryFile
  workspaceService: WorkspaceService
}

const listInvitesRoute = createRoute({
  method: 'get',
  path: '/invites',
  operationId: 'listInvites',
  summary: 'List pending invites. Admin only.',
  tags: ['admin'],
  responses: {
    200: {
      description: 'A list of invites.',
      content: { 'application/json': { schema: InviteListResponse } },
    },
    403: {
      description: 'Caller is not an admin.',
      content: { 'application/problem+json': { schema: z.object({}).passthrough() } },
    },
  },
})

const addInviteRoute = createRoute({
  method: 'post',
  path: '/invites',
  operationId: 'addInvite',
  summary: 'Invite an email to sign in via Google OAuth. Admin only.',
  tags: ['admin'],
  request: { body: { content: { 'application/json': { schema: InviteDraft } } } },
  responses: {
    201: {
      description: 'The created invite.',
      content: { 'application/json': { schema: Invite } },
    },
    400: ValidationFailureResponse,
    403: {
      description: 'Caller is not an admin.',
      content: { 'application/problem+json': { schema: z.object({}).passthrough() } },
    },
  },
})

const revokeInviteRoute = createRoute({
  method: 'delete',
  path: '/invites/{email}',
  operationId: 'revokeInvite',
  summary: 'Revoke a pending invite. Admin only. Idempotent.',
  tags: ['admin'],
  request: { params: EmailParam },
  responses: {
    204: { description: 'Invite removed (or never existed).' },
    403: {
      description: 'Caller is not an admin.',
      content: { 'application/problem+json': { schema: z.object({}).passthrough() } },
    },
  },
})

const listUsersRoute = createRoute({
  method: 'get',
  path: '/users',
  operationId: 'listUsersAdmin',
  summary: 'List all users on this server. Admin only.',
  tags: ['admin'],
  responses: {
    200: {
      description: 'A list of users.',
      content: { 'application/json': { schema: UserListResponse } },
    },
    403: {
      description: 'Caller is not an admin.',
      content: { 'application/problem+json': { schema: z.object({}).passthrough() } },
    },
  },
})

const updateUserRoute = createRoute({
  method: 'patch',
  path: '/users/{userId}',
  operationId: 'updateUserAdmin',
  summary: 'Flip a user\'s server role. Admin only.',
  tags: ['admin'],
  request: {
    params: UserIdParam,
    body: { content: { 'application/json': { schema: AdminUserPatch } } },
  },
  responses: {
    200: {
      description: 'The updated user.',
      content: { 'application/json': { schema: User } },
    },
    404: NotFoundResponse,
    403: {
      description: 'Caller is not an admin.',
      content: { 'application/problem+json': { schema: z.object({}).passthrough() } },
    },
  },
})

const deleteUserRoute = createRoute({
  method: 'delete',
  path: '/users/{userId}',
  operationId: 'deleteUserAdmin',
  summary: 'Delete a user record. Admin only. Idempotent. Does NOT clean up workspace memberships referencing this userId; those rows become orphans.',
  tags: ['admin'],
  request: { params: UserIdParam },
  responses: {
    204: { description: 'User removed (or never existed).' },
    400: {
      description: 'Caller attempted to delete themselves.',
      content: { 'application/problem+json': { schema: z.object({}).passthrough() } },
    },
    403: {
      description: 'Caller is not an admin.',
      content: { 'application/problem+json': { schema: z.object({}).passthrough() } },
    },
  },
})

export function createAdminRouter(deps: AdminRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()
  router.use('*', requireAdmin(deps.userRegistry))

  router.openapi(listInvitesRoute, async (context) => {
    const items = await deps.accessPolicy.listInvites()
    return context.json({ items }, 200)
  })

  router.openapi(addInviteRoute, async (context) => {
    const draft = context.req.valid('json')
    const created = await deps.accessPolicy.addInvite({
      email: draft.email,
      ...(draft.serverRole ? { serverRole: draft.serverRole } : {}),
    })
    return context.json(created, 201)
  })

  router.openapi(revokeInviteRoute, async (context) => {
    const { email } = context.req.valid('param')
    await deps.accessPolicy.removeInvite(email)
    return context.body(null, 204)
  })

  router.openapi(listUsersRoute, async (context) => {
    const [users, workspaces, entries] = await Promise.all([
      deps.userRegistry.list(),
      deps.workspaceService.list(),
      deps.workspaceRegistry.listAllWithMembers(),
    ])
    // Build rootPath → workspaceId so we can attach a human id to each
    // membership without exposing rootPath to the client.
    const idByRoot = new Map(workspaces.map(w => [w.rootPath, w.id]))
    const membershipByUser = new Map<string, Array<{ workspaceId: WorkspaceIdType, role: WorkspaceRoleType }>>()
    for (const entry of entries) {
      const workspaceId = idByRoot.get(entry.rootPath)
      if (!workspaceId)
        continue
      for (const member of entry.members) {
        const list = membershipByUser.get(member.userId) ?? []
        list.push({ workspaceId, role: member.role })
        membershipByUser.set(member.userId, list)
      }
    }
    const items = users.map(u => ({
      ...u,
      workspaces: membershipByUser.get(u.id) ?? [],
    }))
    return context.json({ items }, 200)
  })

  router.openapi(updateUserRoute, async (context) => {
    const { userId } = context.req.valid('param')
    const patch = context.req.valid('json')
    const existing = await deps.userRegistry.get(userId)
    if (!existing)
      throw new NotFoundError(`User "${userId}" not found`)
    const updated = await deps.userRegistry.update(userId, { serverRole: patch.serverRole })
    return context.json(updated, 200)
  })

  router.openapi(deleteUserRoute, async (context) => {
    const { userId } = context.req.valid('param')
    const callerId = getUserId(context)
    // Don't let an admin delete themselves; a single-admin server
    // would lock itself out otherwise.
    if (userId === callerId) {
      return context.json(
        {
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: 'You cannot delete your own user record.',
        },
        400,
        { 'Content-Type': 'application/problem+json' },
      )
    }
    await deps.userRegistry.delete(userId)
    return context.body(null, 204)
  })

  return router
}
