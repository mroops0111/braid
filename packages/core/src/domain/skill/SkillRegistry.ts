import type { SkillId, UnloadableSkill } from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'
import type { SkillManifest } from './SkillManifest.js'

export interface SkillRegistry {
  list: (workspace: Workspace) => Promise<readonly SkillManifest[]>
  find: (workspace: Workspace, skillId: SkillId) => Promise<SkillManifest | undefined>
  get: (workspace: Workspace, skillId: SkillId) => Promise<SkillManifest>
  /**
   * The workspace's own skill files that did not load, and why.
   *
   * Separate from `list` because these have no manifest to carry,
   * and because every caller that stages or runs a skill,
   * wants the list to hold only what it can actually hand to an agent.
   */
  listUnloadable: (workspace: Workspace) => Promise<readonly UnloadableSkill[]>
}
