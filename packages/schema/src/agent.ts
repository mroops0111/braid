import { z } from 'zod'
import { AgentId } from './common.js'

export const TaskName = z.string().min(1).brand<'TaskName'>()
export type TaskName = z.infer<typeof TaskName>

export const AgentKind = z.string().min(1).brand<'AgentKind'>()
export type AgentKind = z.infer<typeof AgentKind>

export const AgentEffort = z.enum(['low', 'medium', 'high'])
export type AgentEffort = z.infer<typeof AgentEffort>

export const AgentBindingDescriptor = z.object({
  id: AgentId,
  kind: AgentKind,
  model: z.string().min(1),
  effort: AgentEffort.optional(),
  extraArgs: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
})
export type AgentBindingDescriptor = z.infer<typeof AgentBindingDescriptor>

export const AgentRoutingConfig = z.object({
  default: z.string().min(1),
  tasks: z.record(z.string()).default({}),
})
export type AgentRoutingConfig = z.infer<typeof AgentRoutingConfig>
