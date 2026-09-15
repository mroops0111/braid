import { z } from 'zod'
import { Actor, UserId, WorkspaceId } from './common.js'
import { UserKind } from './user.js'

/**
 * A run reached a point only a person can settle, and handed it over.
 *
 * Always from a run to a person, never the other way,
 * and never between two runs, which is what the word means elsewhere.
 * Answering a clarification carries its run on,
 * but that is the answer travelling back, not a second handoff.
 *
 * A proposal and a clarification are the two shapes this takes.
 * What makes both one kind is who must act next,
 * rather than whether a run is parked waiting on it,
 * since a proposal ends its run and a resuming clarification suspends one.
 */
export const HandoffKind = z.enum(['proposal', 'clarification'])
export type HandoffKind = z.infer<typeof HandoffKind>

/**
 * Who handed this over, snapshotted at the moment they did.
 *
 * The display name survives a rename, because it records who it was then.
 * A 'service' kind marks an autonomous handoff,
 * which belongs to the workspace rather than to any one person,
 * so everybody who may act on handoffs sees it.
 */
export const HandoffOwner = z.object({
  owner: Actor,
  ownerDisplayName: z.string().min(1).optional(),
  ownerKind: UserKind.optional(),
})
export type HandoffOwner = z.infer<typeof HandoffOwner>

/**
 * The query shape every handoff listing shares.
 *
 * A present `viewerId` narrows the result to what that person may see,
 * which is their own plus anything a service handed over.
 * Absent applies no narrowing, which is what `workspace.manage` grants.
 * Each kind extends this with its own statuses,
 * since the two do not share a status enum.
 */
export const HandoffFilter = z.object({
  workspaceId: WorkspaceId.optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  viewerId: UserId.optional(),
})
export type HandoffFilter = z.infer<typeof HandoffFilter>
