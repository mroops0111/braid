import { z } from 'zod'
import { PluginId } from './common.js'

export const StorageKind = z.string().min(1).brand<'StorageKind'>()
export type StorageKind = z.infer<typeof StorageKind>

export const StorageDescriptor = z.object({
  kind: StorageKind,
  pluginId: PluginId.optional(),
  config: z.unknown(),
})
export type StorageDescriptor = z.infer<typeof StorageDescriptor>

export const Neo4jStorageConfig = z.object({
  uri: z.string().min(1),
  user: z.string().min(1),
  password: z.string().optional(),
  database: z.string().default('neo4j'),
})
export type Neo4jStorageConfig = z.infer<typeof Neo4jStorageConfig>
