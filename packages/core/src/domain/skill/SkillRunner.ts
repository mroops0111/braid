import type { SkillEvent, SkillId, SkillRunId } from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

export interface SkillRunOptions {
  /**
   * Continue a previous claude conversation. The id comes from a prior
   * `session-started` SkillEvent. When set, the agent binding will pass
   * `--resume <sessionId>` so the model keeps its context.
   */
  readonly resumeSessionId?: string
}

export type SkillEventListener = (event: SkillEvent) => void

export interface SkillRunSubscription {
  unsubscribe: () => void
  /**
   * Number of events already emitted (and persisted) for this run when the
   * subscription was attached. Callers can use this to read the first N
   * events from `RunRepository.readEvents` and then continue with events
   * delivered to the listener, guaranteeing no overlap or gaps.
   */
  positionAtSubscribe: number
}

/**
 * Drives a skill run. Implementations spawn the agent subprocess, persist
 * every emitted event via `RunRepository`, and broadcast to subscribers so
 * an HTTP endpoint can replay history + tail live events without coupling
 * the run lifecycle to a single client connection.
 */
export interface SkillRunner {
  /**
   * Spawn a new run. Returns the new run's id once the run is registered;
   * the actual subprocess work continues in the background. Events arrive
   * via `subscribe` and via `RunRepository`.
   */
  start: (
    workspace: Workspace,
    skillId: SkillId,
    args: string,
    options?: SkillRunOptions
  ) => Promise<SkillRunId>

  /**
   * Register a listener for live events on `runId`. Returns immediately
   * with the current emit position so the caller can read JSONL up to
   * that position and continue with the listener with no duplicates.
   * Safe to call on a finished run (listener will simply receive nothing).
   */
  subscribe: (runId: SkillRunId, listener: SkillEventListener) => SkillRunSubscription

  /** True while the run is still draining events. */
  isActive: (runId: SkillRunId) => boolean

  cancel: (runId: SkillRunId) => Promise<void>

  /**
   * Drop any cached state for an agent conversation (claude `--resume`
   * session id). Called by the UI's "New Conversation" flow so the next
   * run starts a fresh agent context and the per-cwd transient files can
   * be reclaimed.
   */
  forgetSession: (sessionId: string) => Promise<void>
}
