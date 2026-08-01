import type { SkillFrontmatter, User, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'

/**
 * The single resolved-identity object that every capability check reads.
 * Built once per request by `resolveViewer`,
 * then passed unchanged into the registry.
 *
 * Permission gates read `effectiveRole`,
 * where admins always land as owner regardless of any member row.
 * `member` is the stored row when present,
 * used for display and skillOverrides lookup,
 * and stays independent of effectiveRole.
 * An admin who joined as a guest has a guest member.role,
 * yet an owner effectiveRole.
 *
 * `resource` is the per-action context the check needs.
 * skill.run reads `skill`, the manifest, along with `skillId`.
 * Future checks can extend it without breaking siblings.
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
