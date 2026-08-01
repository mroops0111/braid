/**
 * Deferred one-shot execution port.
 * `schedule` runs `task` once after `delayMs`,
 * and returns a handle whose `cancel` drops it if still pending.
 * Injected like `Clock` so time-based behaviour stays testable.
 */
export interface Scheduler {
  schedule: (delayMs: number, task: () => void) => ScheduledTask
}

export interface ScheduledTask {
  cancel: () => void
}
