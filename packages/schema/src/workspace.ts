import { z } from 'zod'
import { AgentRoutingConfig } from './agent.js'
import { AbsolutePath, OntologyId, WorkspaceId } from './common.js'
import { PluginDescriptor } from './plugin.js'
import { SourceDescriptor } from './source.js'

export const CodeRef = z.object({
  name: z.string(),
  path: AbsolutePath,
  language: z.string().optional(),
})
export type CodeRef = z.infer<typeof CodeRef>

export const IntentRef = z.object({
  name: z.string(),
  path: AbsolutePath,
})
export type IntentRef = z.infer<typeof IntentRef>

export const PluginConfig = z.object({
  plugins: z.array(PluginDescriptor).default([]),
})
export type PluginConfig = z.infer<typeof PluginConfig>

export const ProductManifest = z.object({
  name: z.string().min(1),
  version: z.string().default('0.0.0'),
  description: z.string().optional(),
  ontologyId: OntologyId.default('ddd' as OntologyId),
  agents: AgentRoutingConfig,
  sources: z.array(SourceDescriptor).default([]),
})
export type ProductManifest = z.infer<typeof ProductManifest>

export const ProductManifestPatch = ProductManifest.partial()
export type ProductManifestPatch = z.infer<typeof ProductManifestPatch>

export const Workspace = z.object({
  id: WorkspaceId,
  rootPath: AbsolutePath,
  productManifest: ProductManifest,
  pluginConfig: PluginConfig,
  codeRefs: z.array(CodeRef).default([]),
  intentRefs: z.array(IntentRef).default([]),
})
export type Workspace = z.infer<typeof Workspace>
