import type { SkillEvent, SkillId, SkillRunId } from '@telos/schema'
import type { Workspace } from '../workspace/Workspace.js'

export interface SkillRunner {
  run: (workspace: Workspace, skillId: SkillId, args: string) => AsyncIterable<SkillEvent>
  resume: (workspace: Workspace, runId: SkillRunId, args?: string) => AsyncIterable<SkillEvent>
  cancel: (runId: SkillRunId) => Promise<void>
}
