import type { ScheduledTask, Scheduler } from '../domain/Scheduler.js'

/**
 * `setTimeout`-backed `Scheduler`.
 * Unrefs the timer, so a pending reactor retry never keeps the process alive.
 */
export class SystemScheduler implements Scheduler {
  schedule(delayMs: number, task: () => void): ScheduledTask {
    const handle = setTimeout(task, Math.max(0, delayMs))
    if (typeof handle === 'object' && handle !== null && 'unref' in handle)
      (handle as { unref: () => void }).unref()
    return { cancel: () => clearTimeout(handle) }
  }
}
