import type { SkillFrontmatter, User, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'

/**
 * The single resolved-identity object that every capability check
 * reads. Built once per request by `resolveViewer`; passed unchanged
 * into the registry.
 *
 * `effectiveRole` is what permission gates use: admins always land as
 * `'owner'` here, regardless of whether they have an explicit member
 * row. `member` is the stored row when present (used for display +
 * skillOverrides lookup) and is independent of effectiveRole. Admin
 * who joined as Guest has member.role='guest' but effectiveRole='owner'.
 *
 * `resource` is the per-action context the check needs:
 *   - skill.run uses `skill` (manifest) + `skillId`
 *   - future checks can extend this without breaking siblings
 */
export interface ViewerContext {
  readonly user: User
  readonly member: WorkspaceMember | undefined
  readonly effectiveRole: WorkspaceRole | null
  readonly resource?: ViewerResource | undefined
}

export interface ViewerResource {
  readonly skill?: SkillFrontmatter
  readonly skillId?: string
}
