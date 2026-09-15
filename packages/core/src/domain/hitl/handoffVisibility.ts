import type { Actor, ClarificationStatus, ProposalStatus, UserId, UserKind } from '@braidhq/schema'

/** The part of a handoff that decides who may see it. */
export interface HandoffVisibility {
  readonly status: ProposalStatus | ClarificationStatus
  readonly owner: Actor
  readonly ownerKind?: UserKind | undefined
}

/**
 * Whether one person may see a handoff that somebody else may have made.
 *
 * An applied handoff is public, because it is part of why the graph says
 * what it says, and hiding it would hide the model's own provenance.
 * Everything else stays with whoever handed it over,
 * plus whatever a service handed over,
 * which belongs to the workspace rather than to any one person.
 *
 * Callers holding `workspace.manage` skip this by passing no viewer at all,
 * which is the one way to see another person's unsettled work.
 */
export function handoffVisibleTo(handoff: HandoffVisibility, viewerId: UserId): boolean {
  return handoff.status === 'applied'
    || handoff.owner === viewerId
    || handoff.ownerKind === 'service'
}
