import type { Clarification, CoverageCard, Proposal } from '@braidhq/schema'

/**
 * One waiting thing, whichever kind it is.
 *
 * The list is shared because a reviewer asks one question of it, what needs me.
 * The detail is not, because answering a question and reviewing a diff are
 * different acts, and collapsing them into one shape would serve neither.
 *
 * A parked run is one item however many questions it holds, because one run is
 * one interrupt and answering the last of them carries that one run on. A
 * standing question stands alone, because nothing groups it and nothing waits.
 */
export type Item =
  | { readonly kind: 'running', readonly id: string, readonly card: CoverageCard }
  | { readonly kind: 'parked', readonly id: string, readonly questions: readonly Clarification[] }
  | { readonly kind: 'question', readonly id: string, readonly record: Clarification }
  | { readonly kind: 'proposal', readonly id: string, readonly at: string, readonly record: Proposal }

/**
 * The waiting things, grouped the way they are actually waited on.
 *
 * Pure, so what belongs together is a rule rather than a rendering accident.
 */
export function buildItems(input: {
  pending: readonly Clarification[]
  proposals: readonly Proposal[]
  running: readonly CoverageCard[]
}): Item[] {
  const parked = new Map<string, Clarification[]>()
  const standing: Clarification[] = []
  for (const clarification of input.pending) {
    const runId = clarification.skillRunId
    if (runId && clarification.answerMode === 'resumes')
      parked.set(runId, [...(parked.get(runId) ?? []), clarification])
    else
      standing.push(clarification)
  }

  return [
    // In flight first, because it is the thing most likely to need somebody
    // next, then what is already waiting, then changes newest first.
    ...input.running.map<Item>(card => ({ kind: 'running', id: card.lastRun!.runId, card })),
    ...[...parked.entries()].map<Item>(([runId, questions]) => ({ kind: 'parked', id: runId, questions })),
    ...standing.map<Item>(record => ({ kind: 'question', id: record.id, record })),
    ...[...input.proposals]
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      .map<Item>(record => ({ kind: 'proposal', id: record.id, at: record.generatedAt, record })),
  ]
}
