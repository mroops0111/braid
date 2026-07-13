import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentId,
  AgentKind,
  McpServerConfig,
  ProductManifest,
  SourceDescriptor,
  SourceId,
  StorageDescriptor,
  StorageKind,
  WorkspaceId,
} from '@braidhq/schema'
import { Workspace } from '@braidhq/core'

// Sample binding for tests that construct a ClaudeCodeAgentBinding directly.
export const DEFAULT_AGENT_BINDING: AgentBindingDescriptor = {
  id: 'claude-code' as AgentId,
  kind: 'claude-code' as AgentKind,
  model: 'opus',
  effort: 'high',
  extraArgs: [],
  env: {},
}

const DEFAULT_STORAGE: StorageDescriptor = {
  kind: 'in-memory' as StorageKind,
  config: {},
}

export interface MakeWorkspaceOptions {
  readonly id?: string
  readonly rootPath?: AbsolutePath
  readonly sources?: readonly SourceDescriptor[]
  readonly mcpServers?: readonly McpServerConfig[]
  readonly storage?: StorageDescriptor
  readonly ontologyId?: string
}

/**
 * Construct a `Workspace` aggregate for tests. Defaults give the happy-path shape (DDD ontology, in-memory storage,
 * one filesystem code source), override per test for the specific axis under test.
 *
 * The `id` and `manifest.name` are kept aligned so the production invariant `WorkspaceId === manifest.name` holds.
 */
export function makeWorkspace(opts: MakeWorkspaceOptions = {}): Workspace {
  const id = opts.id ?? 'ws-1'
  const rootPath = opts.rootPath ?? ('/abs/ws' as AbsolutePath)
  const manifest: ProductManifest = {
    name: id,
    version: '0.0.0',
    ontologyId: (opts.ontologyId ?? 'ddd') as never,
    sources: [...(opts.sources ?? [defaultCodeSource(rootPath)])],
    mcpServers: [...(opts.mcpServers ?? [])],
    storage: opts.storage ?? DEFAULT_STORAGE,
  }
  return new Workspace({
    id: id as WorkspaceId,
    rootPath,
    productManifest: manifest,
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
