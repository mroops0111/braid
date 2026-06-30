import { z } from 'zod'
import { AgentBindingDescriptor, AgentRoutingConfig } from './agent.js'
import { AbsolutePath, OntologyId, SkillId, Timestamp, UserId, WorkspaceId } from './common.js'
import { McpServerConfig } from './mcp.js'
import { SourceDescriptor } from './source.js'
import { StorageDescriptor } from './storage.js'

/**
 * Workspace-level role. Three tiers per the agreed RBAC:
 *   - owner       sole authority over settings + member management;
 *                 one per workspace; transferable to another maintainer
 *   - maintainer  trusted operator; HITL gate participant (apply /
 *                 reject / answer / skip); runs skills
 *   - guest       read-only by default; Proposals / Clarify / Actions
 *                 tabs hidden in the UI; per-skill overrides can
 *                 selectively unlock skills (e.g. `braid-ask` for a
 *                 support agent)
 *
 * `admin` is intentionally absent — server-wide Admin is a separate
 * concept that lives on `User.serverRole`. An Admin who wants to
 * touch a workspace must be added to its members list explicitly.
 */
export const WorkspaceRole = z.enum(['owner', 'maintainer', 'guest'])
export type WorkspaceRole = z.infer<typeof WorkspaceRole>

/**
 * Per-(member, skill) override of the skill's default `allowedRoles`.
 * `'allow'` opens a skill that the role would otherwise be denied;
 * `'deny'` closes a skill the role would normally have. Inherited
 * (absent) entries follow the skill manifest.
 */
export const SkillPermission = z.enum(['allow', 'deny'])
export type SkillPermission = z.infer<typeof SkillPermission>

export const WorkspaceMember = z.object({
  userId: UserId,
  role: WorkspaceRole,
  joinedAt: Timestamp,
  skillOverrides: z.record(SkillId, SkillPermission).optional(),
})
export type WorkspaceMember = z.infer<typeof WorkspaceMember>

/**
 * Per-workspace reactor settings. The reactor subscribes to
 * `source.synced` events for intent-role sources and runs the active
 * ontology's per-unit skill against new / changed units, then a
 * checkpoint pass. Off by default so a workspace does not start
 * spending on background LLM runs until the operator opts in.
 *
 * `maxRunsPerHour` is a fail-closed hard cap on dispatches per workspace
 * over a rolling one-hour window; the sixth dispatch within an hour
 * emits `reactor.throttled` instead of running.
 */
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
  agents: AgentRoutingConfig,
  agentBindings: z.array(AgentBindingDescriptor).default([]),
  storage: StorageDescriptor,
  reactor: ReactorConfig.optional(),
})
export type ProductManifest = z.infer<typeof ProductManifest>

export const ProductManifestPatch = ProductManifest.partial()
export type ProductManifestPatch = z.infer<typeof ProductManifestPatch>

/**
 * Server-fillable subset used by the scaffold endpoint. The user provides
 * only what they care about (name, sources, mcpServers); the server
 * defaults the agent + storage blocks so the resulting PRODUCT.md is a
 * complete, valid `ProductManifest`.
 */
export const ProductManifestDraft = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  ontologyId: OntologyId.optional(),
  sources: z.array(SourceDescriptor).default([]),
  mcpServers: z.array(McpServerConfig).default([]),
  storage: StorageDescriptor.optional(),
  agents: AgentRoutingConfig.optional(),
  agentBindings: z.array(AgentBindingDescriptor).optional(),
})
export type ProductManifestDraft = z.infer<typeof ProductManifestDraft>

export const Workspace = z.object({
  id: WorkspaceId,
  rootPath: AbsolutePath,
  productManifest: ProductManifest,
})
export type Workspace = z.infer<typeof Workspace>
