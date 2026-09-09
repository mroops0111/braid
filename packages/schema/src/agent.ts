import { z } from 'zod'
import { AgentId, Timestamp } from './common.js'

/** Open by design. A new coding agent registers a kind, no schema change needed. */
export const AgentKind = z.string().min(1).brand<'AgentKind'>()
export type AgentKind = z.infer<typeof AgentKind>

export const AgentEffort = z.enum(['low', 'medium', 'high'])
export type AgentEffort = z.infer<typeof AgentEffort>

/** One agent's launch config. kind picks the plugin, the rest configures it. */
export const AgentBindingDescriptor = z.object({
  id: AgentId,
  kind: AgentKind,
  model: z.string().min(1),
  effort: AgentEffort.optional(),
  extraArgs: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
})
export type AgentBindingDescriptor = z.infer<typeof AgentBindingDescriptor>

/**
 * What a reader may learn about a stored agent credential.
 *
 * Never the credential.
 * The store keeps it encrypted and no route reads it back,
 * so the owner sees enough to recognise which one they saved,
 * and nothing an onlooker could use.
 */
export const AgentCredentialSummary = z.object({
  kind: AgentKind,
  /** Last few characters, so an owner can tell two of their tokens apart. */
  hint: z.string().min(1).max(8),
  updatedAt: Timestamp,
  lastUsedAt: Timestamp.optional(),
}).openapi('AgentCredentialSummary')
export type AgentCredentialSummary = z.infer<typeof AgentCredentialSummary>

/**
 * Which account a run would spend.
 *
 * `own` is the author's stored credential,
 * `server` the deployment's shared one,
 * and `none` says a run would be refused.
 * Shown so a reader knows which side of a shared seat they are on.
 */
export const AgentCredentialSource = z.enum(['own', 'server', 'none'])
export type AgentCredentialSource = z.infer<typeof AgentCredentialSource>
