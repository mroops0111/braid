import type { SkillEvent, SkillId, SkillRunId } from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

export interface SkillRunOptions {
  /**
   * Continue a previous claude conversation.
   * The id comes from a prior `session-started` SkillEvent.
   * When set, the agent binding passes `--resume <sessionId>`,
   * so the model keeps its context.
   */
  readonly resumeSessionId?: string
  /**
   * Extra environment variables merged into the spawned skill's env.
   * Used by orchestration code when the single positional `args` is taken,
   * e.g. `BatchService` passing `BRAID_CHANGED_UNITS` to `ddd:model`.
   */
  readonly extraEnv?: Readonly<Record<string, string>>
  /**
   * Bearer token the spawned subprocess uses to call back into Braid,
   * through the `braid-core` MCP gateway on the REST API.
   * Route handlers forward the caller's session token here,
   * so the agent inherits the user's permissions.
   * Absent in `BRAID_LOCAL_TRUST=true` mode, where anonymous traffic is allowed.
   */
  readonly callerToken?: string
}

export type SkillEventListener = (event: SkillEvent) => void

export interface SkillRunSubscription {
  unsubscribe: () => void
  /**
   * Number of events already emitted and persisted for this run,
   * at the moment the subscription was attached.
   * Callers read the first N events from `RunRepository.readEvents`,
   * then continue with events delivered to the listener, guaranteeing no gaps.
   */
  positionAtSubscribe: number
}

/**
 * Drives a skill run. Implementations spawn the agent subprocess,
 * persist every emitted event via `RunRepository`, and broadcast to subscribers.
 * An HTTP endpoint can then replay history and tail live events,
 * without coupling the run lifecycle to a single client connection.
 */
export interface SkillRunner {
  /**
   * Spawn a new run. Returns the new run's id once the run is registered.
   * The actual subprocess work continues in the background.
   * Events arrive via `subscribe` and via `RunRepository`.
   */
  start: (
    workspace: Workspace,
    skillId: SkillId,
    args: string,
    options?: SkillRunOptions
  ) => Promise<SkillRunId>

  /**
   * Register a listener for live events on `runId`.
   * Returns immediately with the current emit position,
   * so the caller can read JSONL up to that position,
   * then continue with the listener with no duplicates.
   * Safe to call on a finished run, the listener simply receives nothing.
   */
  subscribe: (runId: SkillRunId, listener: SkillEventListener) => SkillRunSubscription

  /** True while the run is still draining events. */
  isActive: (runId: SkillRunId) => boolean

  cancel: (runId: SkillRunId) => Promise<void>

  /**
   * Drop any cached state for an agent conversation, the claude `--resume` session id.
   * Called by the UI's "New Conversation" flow,
   * so the next run starts fresh and the per-cwd transient files can be reclaimed.
   */
  forgetSession: (sessionId: string) => Promise<void>
}
