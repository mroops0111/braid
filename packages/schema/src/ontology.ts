import { z } from 'zod'

export const NodeTypeId = z.string().min(1).brand<'NodeTypeId'>()
export type NodeTypeId = z.infer<typeof NodeTypeId>

export const EdgeTypeId = z.string().min(1).brand<'EdgeTypeId'>()
export type EdgeTypeId = z.infer<typeof EdgeTypeId>

export const NodeStatus = z.enum(['draft', 'completed', 'unclear', 'deprecated'])
export type NodeStatus = z.infer<typeof NodeStatus>
