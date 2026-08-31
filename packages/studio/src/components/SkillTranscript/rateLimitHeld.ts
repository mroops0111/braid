/**
 * Whether a rate-limit event means the run is actually held.
 *
 * The agent reports a status on every run, and warns while still serving,
 * using an `allowed_` prefix for the states that let the run proceed.
 * Treating any reported limit as a stall makes a routine warning,
 * look like the run stopped.
 */
export function rateLimitHeld(status: string): boolean {
  return !status.startsWith('allowed')
}
