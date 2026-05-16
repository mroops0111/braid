import type { SkillEvent } from '@braidhq/schema'
import { useSyncExternalStore } from 'react'
import { type RunPhase, type RunState, runStore } from './runStore'

export function useRun(workspaceId: string | null, runId: string | null | undefined): RunState | undefined {
  return useSyncExternalStore(
    cb => runStore.subscribe(cb),
    () => (workspaceId && runId ? runStore.getRun(workspaceId, runId) : undefined),
  )
}

export interface ConversationView {
  readonly turnIds: readonly string[]
  readonly events: readonly SkillEvent[]
  readonly sessionId: string | null
  readonly phase: RunPhase | 'idle'
  readonly error?: string
}

const EMPTY_CONVERSATION: ConversationView = Object.freeze({
  turnIds: [],
  events: [],
  sessionId: null,
  phase: 'idle' as const,
})

/**
 * Aggregated view of the conversation currently displayed in the Skills
 * panel for `(workspaceId, skillId)`. Concatenates events across every turn
 * so the transcript reads top-to-bottom like a normal chat.
 *
 * Snapshots are cached so `useSyncExternalStore` sees a stable reference
 * when nothing relevant changed; otherwise React 19 treats every render as
 * a state change and warns about infinite re-renders.
 */
export function useConversation(workspaceId: string | null, skillId: string | null): ConversationView {
  return useSyncExternalStore(
    cb => runStore.subscribe(cb),
    () => getConversationSnapshot(workspaceId, skillId),
  )
}

const conversationCache = new Map<string, ConversationView>()
const conversationInputs = new Map<string, { turnIds: readonly string[], states: readonly (RunState | undefined)[] }>()

function getConversationSnapshot(workspaceId: string | null, skillId: string | null): ConversationView {
  if (!workspaceId || !skillId)
    return EMPTY_CONVERSATION
  const key = `${workspaceId}|${skillId}`
  const turnIds = runStore.getTurns(workspaceId, skillId)
  const states = turnIds.map(id => runStore.getRun(workspaceId, id))
  const cached = conversationInputs.get(key)
  if (cached && shallowEqualReadonly(cached.turnIds, turnIds) && shallowEqualReadonly(cached.states, states)) {
    return conversationCache.get(key) ?? EMPTY_CONVERSATION
  }
  if (turnIds.length === 0) {
    conversationInputs.set(key, { turnIds: [], states: [] })
    conversationCache.set(key, EMPTY_CONVERSATION)
    return EMPTY_CONVERSATION
  }
  const events: SkillEvent[] = []
  let sessionId: string | null = null
  let phase: RunPhase | 'idle' = 'idle'
  let error: string | undefined
  for (const state of states) {
    if (!state)
      continue
    events.push(...state.events)
    if (state.sessionId)
      sessionId = state.sessionId
    phase = state.phase
    if (state.error)
      error = state.error
  }
  const snapshot: ConversationView = {
    turnIds,
    events,
    sessionId,
    phase,
    ...(error ? { error } : {}),
  }
  conversationInputs.set(key, { turnIds, states })
  conversationCache.set(key, snapshot)
  return snapshot
}

function shallowEqualReadonly<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b)
    return true
  if (a.length !== b.length)
    return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i])
      return false
  }
  return true
}
