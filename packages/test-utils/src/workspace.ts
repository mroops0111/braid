import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentId,
  AgentKind,
  FilesystemSourceDescriptor,
  LoaderKind,
  McpServerConfig,
  ProductManifest,
  SourceDescriptor,
  SourceId,
  StorageDescriptor,
  StorageKind,
  WorkspaceId,
} from '@braidhq/schema'
import { Workspace } from '@braidhq/core'
import { SourceRole } from '@braidhq/schema'

/** Sample binding for tests that construct a ClaudeCodeAgentBinding directly. */
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
 * Construct a Workspace aggregate for tests.
 * Defaults give the happy-path shape, a DDD ontology, in-memory storage,
 * and one filesystem code source. Override per test for the axis under test.
 * The id and manifest.name are kept aligned,
 * so the production invariant WorkspaceId === manifest.name holds.
 */
export function makeWorkspace(opts: MakeWorkspaceOptions = {}): Workspace {
  const id = opts.id ?? 'ws-1'
  const rootPath = opts.rootPath ?? ('/abs/ws' as AbsolutePath)
  const manifest: ProductManifest = {
    name: id,
    version: '0.0.0',
    ontologyId: (opts.ontologyId ?? 'ddd') as never,
    sources: [...(opts.sources ?? [defaultSource(rootPath)])],
    mcpServers: [...(opts.mcpServers ?? [])],
    storage: opts.storage ?? DEFAULT_STORAGE,
  }
  return new Workspace({
    id: id as WorkspaceId,
    rootPath,
    productManifest: manifest,
  })
}

function defaultSource(rootPath: AbsolutePath): SourceDescriptor {
  return {
    kind: 'filesystem',
    id: 'source-default' as SourceId,
    role: SourceRole.parse('primary'),
    name: 'default',
    path: rootPath,
  }
}

export interface MakeFilesystemSourceOptions {
  readonly id?: string
  readonly role?: string
  readonly path?: AbsolutePath
  /** `null` builds a manual source, one Braid does not provision. */
  readonly loaderKind?: string | null
  /** Present makes the source self-refreshing, absent leaves it manual-only. */
  readonly maxStalenessMs?: number
}

/**
 * A loader-backed filesystem source, the shape most source tests need.
 * Defaults give a git-backed code source with no staleness budget,
 * so a test states only the axis it exercises.
 */
export function makeFilesystemSource(options: MakeFilesystemSourceOptions = {}): FilesystemSourceDescriptor {
  const id = options.id ?? 'source-1'
  const loaderKind = options.loaderKind === undefined ? 'git' : options.loaderKind
  return {
    kind: 'filesystem',
    id: id as SourceId,
    role: SourceRole.parse(options.role ?? 'code'),
    name: id,
    path: options.path ?? ('/abs/ws/code' as AbsolutePath),
    ...(loaderKind === null ? {} : { loader: { kind: loaderKind as LoaderKind, config: { url: 'file:///remote' } } }),
    ...(options.maxStalenessMs === undefined ? {} : { sync: { maxStalenessMs: options.maxStalenessMs } }),
  }
}
