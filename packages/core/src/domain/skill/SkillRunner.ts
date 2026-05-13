import type { SkillEvent, SkillId, SkillRunId } from '@telos/schema'
import type { Workspace } from '../workspace/Workspace.js'

export interface SkillRunOptions {
  /**
   * Continue a previous claude conversation. The id comes from a prior
   * `session-started` SkillEvent. When set, the agent binding will pass
   * `--resume <sessionId>` so the model keeps its context.
   */
  readonly resumeSessionId?: string
}

export interface SkillRunner {
  run: (workspace: Workspace, skillId: SkillId, args: string, options?: SkillRunOptions) => AsyncIterable<SkillEvent>
  resume: (workspace: Workspace, runId: SkillRunId, args?: string) => AsyncIterable<SkillEvent>
  cancel: (runId: SkillRunId) => Promise<void>
  /**
   * Drop any cached state for an agent conversation (claude `--resume`
   * session id). Called by the UI's "New Conversation" flow so the next
   * run starts a fresh agent context and the per-cwd transient files can
   * be reclaimed.
   */
  forgetSession: (sessionId: string) => Promise<void>
}
