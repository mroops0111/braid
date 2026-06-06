import type { SkillFrontmatter, User, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'

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
