import type { SkillId } from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'
import type { SkillManifest } from './SkillManifest.js'

export interface SkillRegistry {
  list: (workspace: Workspace) => Promise<readonly SkillManifest[]>
  find: (workspace: Workspace, skillId: SkillId) => Promise<SkillManifest | undefined>
  get: (workspace: Workspace, skillId: SkillId) => Promise<SkillManifest>
}
