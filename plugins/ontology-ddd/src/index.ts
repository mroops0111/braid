import { z } from 'zod'

export const DDD_NODE_TYPES = [
  'boundedContext',
  'aggregate',
  'command',
  'query',
  'event',
  'rule',
] as const

export const DDDNodeType = z.enum(DDD_NODE_TYPES)
export type DDDNodeType = z.infer<typeof DDDNodeType>

export const DDD_EDGE_TYPES = [
  'contains',
  'accepts',
  'emits',
  'triggers',
  'constrainedBy',
  'dependsOn',
] as const

export const DDDEdgeType = z.enum(DDD_EDGE_TYPES)
export type DDDEdgeType = z.infer<typeof DDDEdgeType>
