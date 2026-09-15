import type { SkillFrontmatter, User, UserId, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'

export interface ViewerContext {
  readonly user: User
  readonly member: WorkspaceMember | undefined
  readonly effectiveRole: WorkspaceRole | null
  readonly resource?: ViewerResource | undefined
}

export interface ViewerResource {
  readonly skill?: SkillFrontmatter
  readonly skillId?: string
  /**
   * Who started the conversation being acted on.
   * Read by run.share, which is settled by authorship and not by role.
   */
  readonly sessionStartedBy?: UserId
}
