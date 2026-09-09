import type { SkillEvent } from '@braidhq/schema'

/** What a run cost, as the agent reported it when it finished. */
export interface RunStats {
  readonly turns?: number
  readonly durationMs?: number
  readonly costUsd?: number
}

/**
 * What the run cost, merged across however many usage events it sent.
 *
 * Null until one arrives, which is the whole run for a live one, so a caller
 * shows nothing rather than zeroes that would read as a finished free run.
 */
export function readStats(events: readonly SkillEvent[]): RunStats | null {
  const merged: { turns?: number, durationMs?: number, costUsd?: number } = {}
  let seen = false
  for (const event of events) {
    if (event.type !== 'usage')
      continue
    seen = true
    if (event.turns !== undefined)
      merged.turns = event.turns
    if (event.durationMs !== undefined)
      merged.durationMs = event.durationMs
    if (event.costUsd !== undefined)
      merged.costUsd = event.costUsd
  }
  return seen ? merged : null
}

export function formatStats(stats: RunStats): string {
  return [
    stats.turns != null ? `${stats.turns} turns` : null,
    stats.durationMs != null ? `${(stats.durationMs / 1000 / 60).toFixed(1)}m` : null,
    stats.costUsd != null ? `$${stats.costUsd.toFixed(2)}` : null,
  ].filter(Boolean).join(' · ')
}
