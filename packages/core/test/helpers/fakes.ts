import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentId,
  McpServerConfig,
  McpServerId,
  ProductManifest,
  SkillId,
  SkillManifest as SkillManifestData,
  SourceDescriptor,
  SourceId,
  StorageDescriptor,
  StorageKind,
  WorkspaceId,
} from '@telos/schema'
import { SkillManifest, Workspace } from '../../src/index.js'

export const DEFAULT_AGENT_BINDING: AgentBindingDescriptor = {
  id: 'claude-default' as AgentId,
  kind: 'claude-code' as never,
  model: 'opus',
  effort: 'high',
  extraArgs: [],
  env: {},
}

const DEFAULT_STORAGE: StorageDescriptor = { kind: 'in-memory' as StorageKind, config: {} }

export interface MakeWorkspaceOptions {
  readonly id?: string
  readonly rootPath?: AbsolutePath
  readonly sources?: readonly SourceDescriptor[]
  readonly mcpServers?: readonly McpServerConfig[]
  readonly agentBindings?: readonly AgentBindingDescriptor[]
  readonly agents?: ProductManifest['agents']
  readonly storage?: StorageDescriptor
}

export function makeWorkspace(opts: MakeWorkspaceOptions = {}): Workspace {
  const id = opts.id ?? 'ws-1'
  const rootPath = opts.rootPath ?? ('/abs/ws' as AbsolutePath)
  const manifest: ProductManifest = {
    name: id,
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: opts.agents ?? { default: 'claude-default' as AgentId, tasks: {} },
    agentBindings: [...(opts.agentBindings ?? [DEFAULT_AGENT_BINDING])],
    sources: [...(opts.sources ?? [defaultCodeSource(rootPath)])],
    mcpServers: [...(opts.mcpServers ?? [])],
    storage: opts.storage ?? DEFAULT_STORAGE,
    channels: [],
  }
  return new Workspace({
    id: id as WorkspaceId,
    rootPath,
    productManifest: manifest,
    pluginConfig: { plugins: [] },
  })
}

function defaultCodeSource(rootPath: AbsolutePath): SourceDescriptor {
  return {
    kind: 'filesystem',
    id: 'code-default' as SourceId,
    role: 'code',
    name: 'default',
    path: rootPath,
  }
}

export interface MakeSkillManifestOptions {
  readonly id?: string
  readonly path?: AbsolutePath
  readonly origin?: 'builtin' | 'workspace'
  readonly extensionPath?: AbsolutePath
  readonly name?: string
  readonly description?: string
  readonly requiredEnv?: readonly string[]
  readonly requiredPaths?: readonly string[]
  readonly requiredMcpServers?: readonly McpServerId[]
}

export function makeSkillManifestData(opts: MakeSkillManifestOptions = {}): SkillManifestData {
  const id = opts.id ?? 'telos-ask'
  return {
    id: id as SkillId,
    origin: opts.origin ?? 'builtin',
    path: opts.path ?? (`/abs/skills/${id}/SKILL.md` as AbsolutePath),
    ...(opts.extensionPath ? { extensionPath: opts.extensionPath } : {}),
    frontmatter: {
      name: opts.name ?? id,
      description: opts.description ?? 'test skill',
      disableModelInvocation: false,
      telos: {
        requiredEnv: [...(opts.requiredEnv ?? [])],
        requiredPaths: [...(opts.requiredPaths ?? [])],
        requiredMcpServers: [...(opts.requiredMcpServers ?? [])],
      },
    },
  }
}

export function makeSkillManifest(opts: MakeSkillManifestOptions = {}): SkillManifest {
  return new SkillManifest(makeSkillManifestData(opts))
}
