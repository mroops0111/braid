import type { SkillFrontmatter, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'
import type { Capability } from './Capability'
import { useMemo } from 'react'
import { useMe, useWorkspaceMembers } from '@/lib/queries'
import { defaultPermissionRegistry } from './defaultRegistry'
import { resolveViewer } from './resolveViewer'

export interface ViewerPolicy {
  /**
   * The role used by `can()` checks. Admins always land as `'owner'`
   * regardless of whether they hold an explicit member row; null when
   * the viewer is not a member and not a server admin.
   */
  readonly effectiveRole: WorkspaceRole | null
  /**
   * The viewer's stored member row, if any. Useful for rendering
   * (e.g. show the actual stored role as a chip) but does NOT
   * determine effectiveRole. Admins have effectiveRole=owner even
   * when their stored member.role is something else.
   */
  readonly actualMember: WorkspaceMember | undefined
  /** Server-level admin flag, surfaced for server-scope UI (e.g. Admin Settings tab). */
  readonly isServerAdmin: boolean
  /** Inverse of resolved data: true while either /users/me or /members is loading. */
  readonly loading: boolean
  /** Capability check. Pass a resource object when the capability needs one (e.g. skill.run). */
  can: (capability: Capability, resource?: { skill?: SkillFrontmatter, skillId?: string }) => boolean
}

/**
 * Single hook every component reaches for to ask permission questions.
 * Replaces the previously scattered useMyWorkspaceRole /
 * resolveMyMembership / inline `serverRole === 'admin'` checks.
 */
export function useWorkspacePolicy(workspaceId: string | null): ViewerPolicy {
  const { data: me, isLoading: meLoading } = useMe()
  const { data: members, isLoading: membersLoading } = useWorkspaceMembers(workspaceId ?? undefined)

  return useMemo<ViewerPolicy>(() => {
    const isServerAdmin = me?.serverRole === 'admin'
    if (!me) {
      return {
        effectiveRole: null,
        actualMember: undefined,
        isServerAdmin: false,
        loading: meLoading || membersLoading,
        can: () => false,
      }
    }
    // No workspace context: we still expose the server-admin flag for
    // server-scope surfaces (Settings > Users), but workspace-scoped
    // capability checks have nothing to evaluate against.
    if (!workspaceId) {
      return {
        effectiveRole: null,
        actualMember: undefined,
        isServerAdmin,
        loading: meLoading,
        can: () => false,
      }
    }
    const actualMember = members?.items.find(m => m.userId === me.id)
    const viewer = resolveViewer(me, actualMember)
    return {
      effectiveRole: viewer.effectiveRole,
      actualMember,
      isServerAdmin,
      loading: meLoading || membersLoading,
      can: (capability, resource) => {
        const evaluated = resource
          ? { ...viewer, resource }
          : viewer
        return defaultPermissionRegistry.can(capability, evaluated)
      },
    }
  }, [me, members, workspaceId, meLoading, membersLoading])
}
