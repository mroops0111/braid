import { z } from 'zod'
import { AbsolutePath, OntologyId, SkillId, Timestamp, UserId, WorkspaceId } from './common.js'
import { McpServerConfig } from './mcp.js'
import { SourceDescriptor } from './source.js'
import { StorageDescriptor } from './storage.js'

// owner: settings + members. maintainer: HITL gate + skills. guest: read-only by default.
// admin is deliberately absent: server-wide Admin lives on User.serverRole.
export const WorkspaceRole = z.enum(['owner', 'maintainer', 'guest'])
export type WorkspaceRole = z.infer<typeof WorkspaceRole>

// Per-member skill override: allow opens, deny closes, absent inherits the manifest.
export const SkillPermission = z.enum(['allow', 'deny'])
export type SkillPermission = z.infer<typeof SkillPermission>

export const WorkspaceMember = z.object({
  userId: UserId,
  role: WorkspaceRole,
  joinedAt: Timestamp,
  skillOverrides: z.record(SkillId, SkillPermission).optional(),
})
export type WorkspaceMember = z.infer<typeof WorkspaceMember>

// Off by default so no background LLM spend until the operator opts in.
// maxRunsPerHour: fail-closed hourly cap. Over-cap dispatches emit reactor.throttled.
export const ReactorConfig = z.object({
  enabled: z.boolean().default(false),
  maxRunsPerHour: z.number().int().positive().default(5),
})
export type ReactorConfig = z.infer<typeof ReactorConfig>

export const ProductManifest = z.object({
  name: z.string().min(1),
  version: z.string().default('0.0.0'),
  description: z.string().optional(),
  ontologyId: OntologyId.default('ddd' as OntologyId),
  sources: z.array(SourceDescriptor).default([]),
  mcpServers: z.array(McpServerConfig).default([]),
  storage: StorageDescriptor,
  reactor: ReactorConfig.optional(),
})
export type ProductManifest = z.infer<typeof ProductManifest>

export const ProductManifestUpdate = ProductManifest.partial()
export type ProductManifestUpdate = z.infer<typeof ProductManifestUpdate>

// Scaffold subset: user gives name/sources/mcpServers, server defaults the rest.
export const ProductManifestCreate = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  ontologyId: OntologyId.optional(),
  sources: z.array(SourceDescriptor).default([]),
  mcpServers: z.array(McpServerConfig).default([]),
  storage: StorageDescriptor.optional(),
})
export type ProductManifestCreate = z.infer<typeof ProductManifestCreate>

export const Workspace = z.object({
  id: WorkspaceId,
  rootPath: AbsolutePath,
  productManifest: ProductManifest,
})
export type Workspace = z.infer<typeof Workspace>
