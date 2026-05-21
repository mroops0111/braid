import type { AgentPlugin, OntologyPlugin, SourceLoaderPlugin, StoragePlugin } from '@braidhq/core'
import type { AbsolutePath, AgentEffort, AgentId, AgentKind, StorageKind, WorkspaceId } from '@braidhq/schema'
import type { AppDependencies } from './composition.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { claudeCodeAgentPlugin } from '@braidhq/agent-claude-code'
import {
  builtinSkillsRoot,
  InMemoryWorkspaceEventBus,
  NotFoundError,
  PluginRegistry,
  ValidationError,
} from '@braidhq/core'
import { dddOntology } from '@braidhq/ontology-ddd'
import { StorageKind as StorageKindSchema } from '@braidhq/schema'
import { GoogleDriveLoader } from '@braidhq/source-loader-gdrive'
import { GitLoader } from '@braidhq/source-loader-git'
import { kuzuStoragePlugin } from '@braidhq/storage-kuzu'
import { composeApp } from './composition.js'
import { SubprocessSkillRunner } from './infrastructure/agent/SubprocessSkillRunner.js'
import { FsClarifyTicketRepository } from './infrastructure/fs/FsClarifyTicketRepository.js'
import { FsDecisionRepository } from './infrastructure/fs/FsDecisionRepository.js'
import { FsProposalRepository } from './infrastructure/fs/FsProposalRepository.js'
import { FsRunRepository } from './infrastructure/fs/FsRunRepository.js'
import { FsSkillRegistry } from './infrastructure/fs/FsSkillRegistry.js'
import { FsWorkspaceRepository } from './infrastructure/fs/FsWorkspaceRepository.js'
import { discoverCanonicalWorkspaces } from './infrastructure/fs/WorkspaceDiscovery.js'
import { WorkspaceRegistryFile } from './infrastructure/fs/WorkspaceRegistryFile.js'
import { GoogleOAuth } from './infrastructure/oauth/GoogleOAuth.js'
import { FsSecretStore } from './infrastructure/secrets/SecretStore.js'

export interface ComposeFsOptions {
  /** Where to persist registered workspace paths. Default `$BRAID_HOME` or `~/.braid`. */
  readonly braidHome?: string
  /** URL the server reports to spawned subprocesses for REST callbacks. */
  readonly apiUrl?: string
  /** Coding-agent model selection (default `opus`). */
  readonly agentModel?: string
  /** Coding-agent effort tier (default `high`). */
  readonly agentEffort?: AgentEffort
  /**
   * Graph storage backend kind. Resolved against the StoragePlugin
   * registry; default `kuzu`. Set via `BRAID_STORAGE_KIND` env to swap
   * (e.g. `neo4j` once `@braidhq/storage-neo4j` is registered).
   */
  readonly storageKind?: StorageKind
  /** Coding-agent kind to spawn skill subprocesses with. Default `claude-code`. */
  readonly agentKind?: AgentKind

  /**
   * Extra plugins to register alongside the defaults bundled with this
   * composition. The defaults bundle is:
   *   - storage: `kuzuStoragePlugin`
   *   - ontology: `dddOntology`
   *   - source-loader: `GitLoader` (+ `GoogleDriveLoader` if OAuth configured)
   *   - agent: `claudeCodeAgentPlugin`
   *
   * `composeFsApp` is the opinionated entry that ships with batteries.
   * Callers who want a different bundle should use `composeApp` directly
   * with their own pluginRegistry.
   */
  readonly extraStoragePlugins?: readonly StoragePlugin[]
  readonly extraOntologyPlugins?: readonly OntologyPlugin[]
  readonly extraSourceLoaderPlugins?: readonly SourceLoaderPlugin[]
  readonly extraAgentPlugins?: readonly AgentPlugin[]
}

/**
 * Opinionated production composition: real filesystem persistence for
 * workspaces / proposals / clarify / decisions, built-in skills loaded
 * from `@braidhq/core`, and a batteries-included plugin bundle (Kuzu
 * storage / DDD ontology / Git+GDrive source loaders / Claude Code
 * agent).
 *
 * To run with a different plugin set, either:
 *  1. Pass `extraXxxPlugins` to add alongside defaults + flip `storageKind`
 *     / `agentKind` to pick a different active one, OR
 *  2. Call `composeApp` directly with a `pluginRegistry` you built yourself.
 */
export async function composeFsApp(options: ComposeFsOptions = {}): Promise<AppDependencies> {
  const braidHome = options.braidHome ?? process.env.BRAID_HOME ?? join(homedir(), '.braid')
  const apiUrl = options.apiUrl ?? 'http://localhost:4321'

  const secretStore = new FsSecretStore(join(braidHome, 'secrets'))

  const googleClientId = process.env.BRAID_GOOGLE_CLIENT_ID
  const googleClientSecret = process.env.BRAID_GOOGLE_CLIENT_SECRET
  const googleRedirect = process.env.BRAID_GOOGLE_REDIRECT_URI ?? `${apiUrl}/oauth/google/callback`
  const googleOAuth = googleClientId && googleClientSecret
    ? new GoogleOAuth({ clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirect })
    : undefined

  const registry = new WorkspaceRegistryFile(join(braidHome, 'workspaces.json'))
  const workspaceRepository = new FsWorkspaceRepository({ registry })
  const workspaceRoots = async (): Promise<ReadonlyMap<WorkspaceId, AbsolutePath>> => {
    const workspaces = await workspaceRepository.list()
    return new Map(workspaces.map(ws => [ws.id, ws.rootPath]))
  }

  const proposalRepository = new FsProposalRepository({ workspaceRoots })
  const clarifyRepository = new FsClarifyTicketRepository({ workspaceRoots })
  const decisionRepository = new FsDecisionRepository({ workspaceRoots })

  // Plugin registration. Defaults bundle first, then extras, so a caller
  // that passes (e.g.) `extraOntologyPlugins: [c4]` ends up with both ddd
  // and c4 registered; the active one is chosen per-workspace via
  // PRODUCT.md.ontologyId.
  const pluginRegistry = new PluginRegistry()
  pluginRegistry.register(kuzuStoragePlugin)
  for (const plugin of options.extraStoragePlugins ?? [])
    pluginRegistry.register(plugin)

  pluginRegistry.register(dddOntology)
  for (const plugin of options.extraOntologyPlugins ?? [])
    pluginRegistry.register(plugin)

  pluginRegistry.register(new GitLoader())
  for (const plugin of options.extraSourceLoaderPlugins ?? [])
    pluginRegistry.register(plugin)

  pluginRegistry.register(claudeCodeAgentPlugin)
  for (const plugin of options.extraAgentPlugins ?? [])
    pluginRegistry.register(plugin)

  // GoogleDriveLoader is always registered so a workspace declaring a
  // `kind: gdrive` source doesn't crash at plugin lookup. If OAuth env
  // vars aren't configured, the token resolver throws an actionable
  // error at ingest time so the user knows exactly what to set.
  const oauth = googleOAuth
  pluginRegistry.register(new GoogleDriveLoader({
    resolveAccessToken: async ({ workspaceId, sourceId }) => {
      if (!oauth) {
        throw new ValidationError(
          `Google Drive source "${sourceId}" cannot be loaded: set BRAID_GOOGLE_CLIENT_ID and BRAID_GOOGLE_CLIENT_SECRET on the server, restart, then re-sync.`,
        )
      }
      const key = `${workspaceId}--${sourceId}`
      const stored = await secretStore.read<{
        accessToken: string
        refreshToken: string
        expiresAt: string
      }>('oauth-google', key)
      if (!stored) {
        throw new NotFoundError(
          `Google Drive source "${sourceId}" on workspace "${workspaceId}" is not connected. `
          + `Authorise via POST /oauth/google/start.`,
        )
      }
      // 60-second skew so we don't hand out a token about to expire mid-request.
      const stillValidUntil = new Date(stored.expiresAt).getTime() - 60_000
      if (Date.now() < stillValidUntil)
        return stored.accessToken
      const refreshed = await oauth.refreshAccessToken(stored.refreshToken)
      await secretStore.write('oauth-google', key, {
        ...stored,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      })
      return refreshed.accessToken
    },
  }))

  // Resolve the active storage plugin and ask it for a ModelRepository.
  const storageKind = StorageKindSchema.parse(
    options.storageKind ?? process.env.BRAID_STORAGE_KIND ?? 'kuzu',
  )
  const modelRepository = await pluginRegistry.requireStoragePlugin(storageKind).createModelRepository(
    { kind: storageKind, config: {} },
    {
      workspaceRootPath: braidHome,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      resolveWorkspaceRoot: async (workspaceId: WorkspaceId) => {
        const roots = await workspaceRoots()
        const root = roots.get(workspaceId)
        if (!root)
          throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
        return root
      },
    },
  )

  // Resolve the active agent plugin and build its binding.
  const agentKind = (options.agentKind ?? 'claude-code') as AgentKind
  const agentBinding = pluginRegistry.requireAgentPlugin(agentKind).createBinding({
    id: 'default' as AgentId,
    kind: agentKind,
    model: options.agentModel ?? 'opus',
    effort: options.agentEffort ?? 'high',
    extraArgs: [],
    env: {},
  })

  const runRepository = new FsRunRepository()

  // Built after pluginRegistry is populated so plugin-shipped SKILL.md
  // files mount under the `plugin` skill origin alongside builtins.
  const skillRegistry = new FsSkillRegistry({
    builtinSkillsRoot: builtinSkillsRoot as AbsolutePath,
    pluginRegistry,
  })

  const eventBus = new InMemoryWorkspaceEventBus()
  const skillRunner = new SubprocessSkillRunner({
    skillRegistry,
    agentBinding,
    apiUrl,
    runRepository,
    eventBus,
    referenceDirs: [
      { name: 'shared', path: join(builtinSkillsRoot, 'shared') as AbsolutePath },
    ],
  })

  const workspacesRoot = join(braidHome, 'workspaces') as AbsolutePath
  const deps = composeApp({
    workspaceRepository,
    proposalRepository,
    clarifyRepository,
    decisionRepository,
    modelRepository,
    skillRegistry,
    skillRunner,
    runRepository,
    pluginRegistry,
    eventBus,
    workspacesRoot,
  })

  // Pick up workspaces that exist on disk but aren't in the registry:
  // CLI-created ones, scaffold-orphans, copies-from-another-machine.
  // Registry add is idempotent so this is safe to run on every boot.
  await discoverCanonicalWorkspaces(workspacesRoot, deps.workspaceService)

  return {
    ...deps,
    secretStore,
    ...(googleOAuth ? { googleOAuth } : {}),
  }
}
