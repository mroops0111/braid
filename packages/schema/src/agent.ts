import { z } from 'zod'

export const TaskName = z.string().min(1).brand<'TaskName'>()
export type TaskName = z.infer<typeof TaskName>

export const AgentRoutingConfig = z.object({
  default: z.string().min(1),
  tasks: z.record(z.string()).default({}),
})
export type AgentRoutingConfig = z.infer<typeof AgentRoutingConfig>
