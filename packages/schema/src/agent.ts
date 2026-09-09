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
  /**
   * The credential with its middle removed.
   *
   * Enough of each end for an owner to tell two of their own apart,
   * and far too little for anyone to reconstruct the rest.
   */
  masked: z.string().min(1).max(64),
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

/**
 * An agent this deployment can run, and how to get a credential for it.
 *
 * Served so no page has to name an agent it does not depend on.
 * A deployment that registers a second agent gets a second entry,
 * and every reader of this list follows without being changed.
 */
export const AgentSummary = z.object({
  kind: AgentKind,
  /** The command that produces a credential, where the agent has one. */
  credentialCommand: z.string().min(1).optional(),
}).openapi('AgentSummary')
export type AgentSummary = z.infer<typeof AgentSummary>

export const ListAgentsResponse = z.object({
  agents: z.array(AgentSummary),
}).openapi('ListAgentsResponse')
export type ListAgentsResponse = z.infer<typeof ListAgentsResponse>
