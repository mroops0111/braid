import { z } from 'zod'
import { AgentId } from './common.js'

// Open by design. A new coding agent registers a kind, no schema change needed.
export const AgentKind = z.string().min(1).brand<'AgentKind'>()
export type AgentKind = z.infer<typeof AgentKind>

export const AgentEffort = z.enum(['low', 'medium', 'high'])
export type AgentEffort = z.infer<typeof AgentEffort>

// One agent's launch config. kind picks the plugin, the rest configures it.
export const AgentBindingDescriptor = z.object({
  id: AgentId,
  kind: AgentKind,
  model: z.string().min(1),
  effort: AgentEffort.optional(),
  extraArgs: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
})
export type AgentBindingDescriptor = z.infer<typeof AgentBindingDescriptor>
