import type { Clock, WorkspaceService } from '@braidhq/core'
import type { SkillId, Timestamp, WorkspaceMember as WorkspaceMemberType } from '@braidhq/schema'
import type { WorkspaceRegistryFile } from '../infrastructure/fs/WorkspaceRegistryFile.js'
import { NotFoundError } from '@braidhq/core'
import { SkillPermission, UserId, WorkspaceRole } from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireWorkspaceRole } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'

const AddMemberBody = z.object({
  userId: UserId,
  role: WorkspaceRole.default('guest'),
})

const PatchMemberBody = z.object({
  role: WorkspaceRole.optional(),
  skillOverrides: z.record(z.string().min(1), SkillPermission).optional(),
}).refine(body => Object.keys(body).length > 0, {
  message: 'PATCH body must include role and/or skillOverrides',
})

const TransferBody = z.object({
  newOwnerId: UserId,
})

export interface WorkspaceMembersRouterDeps {
  workspaceService: WorkspaceService
  registry: WorkspaceRegistryFile
  clock: Clock
}

export function createWorkspaceMembersRouter(deps: WorkspaceMembersRouterDeps): Hono {
  const router = new Hono()
  const ownerOnly = requireWorkspaceRole('owner')

  // List is open to every member of the workspace. The access
  // middleware upstream already enforced membership.
  router.get('/', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const workspace = await deps.workspaceService.findById(workspaceId)
    const members = await deps.registry.listMembers(workspace.rootPath)
    return context.json({ items: members })
  })

  router.post('/', ownerOnly, zValidator('json', AddMemberBody), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { userId, role } = context.req.valid('json')
    const workspace = await deps.workspaceService.findById(workspaceId)
    const member: WorkspaceMemberType = {
      userId,
      role,
      joinedAt: deps.clock.now() as Timestamp,
    }
    await deps.registry.addMember(workspace.rootPath, member)
    return context.json(member, 201)
  })

  router.patch('/:memberUserId', ownerOnly, zValidator('json', PatchMemberBody), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const memberUserId = UserId.parse(context.req.param('memberUserId'))
    const patch = context.req.valid('json')
    const workspace = await deps.workspaceService.findById(workspaceId)
    const next = await deps.registry.updateMember(workspace.rootPath, memberUserId, {
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.skillOverrides
        ? { skillOverrides: patch.skillOverrides as Record<SkillId, ReturnType<typeof SkillPermission.parse>> }
        : {}),
    })
    return context.json(next)
  })

  router.delete('/:memberUserId', ownerOnly, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const memberUserId = UserId.parse(context.req.param('memberUserId'))
    const workspace = await deps.workspaceService.findById(workspaceId)
    const exists = await deps.registry.getMember(workspace.rootPath, memberUserId)
    if (!exists)
      throw new NotFoundError(`User "${memberUserId}" is not a member of this workspace`)
    await deps.registry.removeMember(workspace.rootPath, memberUserId)
    return context.body(null, 204)
  })

  return router
}

export function createTransferOwnershipRouter(deps: WorkspaceMembersRouterDeps): Hono {
  const router = new Hono()
  router.post('/', requireWorkspaceRole('owner'), zValidator('json', TransferBody), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { newOwnerId } = context.req.valid('json')
    const workspace = await deps.workspaceService.findById(workspaceId)
    await deps.registry.transferOwnership(workspace.rootPath, newOwnerId)
    const members = await deps.registry.listMembers(workspace.rootPath)
    return context.json({ items: members })
  })
  return router
}
