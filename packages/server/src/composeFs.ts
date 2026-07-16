import type { AgentPlugin, OntologyPlugin, SourceLoaderPlugin, StoragePlugin } from '@braidhq/core'
import type { AbsolutePath, AgentBindingDescriptor, AgentEffort, StorageKind, WorkspaceId } from '@braidhq/schema'
import type { AppDependencies } from './composition.js'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { claudeCodeAgentPlugin } from '@braidhq/agent-claude-code'
import {
  builtinSkillsRoot,
  createLogger,
  NotFoundError,
  PluginRegistry,
  ValidationError,
  WorkspaceBootstrapService,
} from '@braidhq/core'
import { InMemoryWorkspaceEventBus } from '@braidhq/core/testing'
import { dddOntology } from '@braidhq/ontology-ddd'
import { AgentId, AgentKind, StorageKind as StorageKindSchema } from '@braidhq/schema'
import { createGoogleDriveLoader } from '@braidhq/source-loader-gdrive'
import { gitLoader } from '@braidhq/source-loader-git'
import { createGithubLoader } from '@braidhq/source-loader-github'
import { kuzuStoragePlugin } from '@braidhq/storage-kuzu'
import { composeApp } from './composition.js'
import { SubprocessSkillRunner } from './infrastructure/agent/SubprocessSkillRunner.js'
import { AccessPolicy } from './infrastructure/auth/AccessPolicy.js'
import { ensureApprovedEmails } from './infrastructure/auth/ensureApprovedEmails.js'
import { SessionStore } from './infrastructure/auth/SessionStore.js'
import { parseBoolEnv } from './infrastructure/env.js'
import { FsBatchPlanRepository } from './infrastructure/fs/FsBatchPlanRepository.js'
import { FsClarifyTicketRepository } from './infrastructure/fs/FsClarifyTicketRepository.js'
import { FsModelSerializer } from './infrastructure/fs/FsModelSerializer.js'
import { FsProposalRepository } from './infrastructure/fs/FsProposalRepository.js'
import { FsReactorCycleRepository } from './infrastructure/fs/FsReactorCycleRepository.js'
import { FsRunRepository } from './infrastructure/fs/FsRunRepository.js'
import { FsSkillRegistry } from './infrastructure/fs/FsSkillRegistry.js'
import { FsSourceUnitDigest } from './infrastructure/fs/FsSourceUnitDigest.js'
import { FsSourceUnitObservationRepository } from './infrastructure/fs/FsSourceUnitObservationRepository.js'
import { FsWorkspaceRepository } from './infrastructure/fs/FsWorkspaceRepository.js'
import { listIntentItems } from './infrastructure/fs/intentScan.js'
import { discoverCanonicalWorkspaces } from './infrastructure/fs/WorkspaceDiscovery.js'
import { WorkspaceRegistryFile } from './infrastructure/fs/WorkspaceRegistryFile.js'
import { GitWorkspaceHistory } from './infrastructure/git/GitWorkspaceHistory.js'
import { GoogleOAuth } from './infrastructure/oauth/GoogleOAuth.js'
import { FsSecretStore } from './infrastructure/secrets/SecretStore.js'
import { ensureLocalUser } from './infrastructure/users/ensureLocalUser.js'
import { ensureWorkspaceOwners } from './infrastructure/users/ensureWorkspaceOwners.js'
import { UserDirectoryFromRegistry } from './infrastructure/users/UserDirectoryFromRegistry.js'
import { UserRegistryFile } from './infrastructure/users/UserRegistryFile.js'

export interface ComposeFsOptions {
  /**
   * Where to persist registered workspace paths. Default `$BRAID_HOME` or `~/.braid`.
   */
  readonly braidHome?: string
  /** URL the server reports to spawned subprocesses for REST callbacks. */
  readonly apiUrl?: string
  /** Coding-agent model selection (default `opus`). */
  readonly agentModel?: string
  /** Coding-agent effort tier (default `high`). */
  readonly agentEffort?: AgentEffort
  /**
   * Graph storage backend kind, resolved against the StoragePlugin registry. Default `kuzu`.
   * Set via `BRAID_STORAGE_KIND` env to swap, e.g. `neo4j` once `@braidhq/storage-neo4j` is registered.
   */
  readonly storageKind?: StorageKind
  /** Coding-agent kind to spawn skill subprocesses with. Default `claude-code`. */
  readonly agentKind?: AgentKind

  /**
   * Extra plugins registered alongside the defaults this composition bundles. The defaults bundle is:
   * - storage: `kuzuStoragePlugin`
   * - ontology: `dddOntology`
   * - source-loader: `gitLoader`, `createGithubLoader()`, `createGoogleDriveLoader()`
   * (gdrive throws an actionable error at provision if OAuth env is missing,
   * github falls back to anonymous if `${GH_TOKEN}` is unset,
   * subject to the 60 req/h public rate limit).
   * - agent: `claudeCodeAgentPlugin`
   *
   * `composeFsApp` is the opinionated entry that ships with batteries.
   * Callers who want a different bundle should use `composeApp` directly, with their own pluginRegistry.
   */
  readonly extraStoragePlugins?: readonly StoragePlugin[]
  readonly extraOntologyPlugins?: readonly OntologyPlugin[]
  readonly extraSourceLoaderPlugins?: readonly SourceLoaderPlugin[]
  readonly extraAgentPlugins?: readonly AgentPlugin[]
}

/**
 * Opinionated production composition. Filesystem-persists workspaces, proposals, clarify, and decisions.
 * Built-in skills load from `@braidhq/core`. Ships a batteries-included bundle of Kuzu storage, DDD ontology,
 * Git and GDrive source loaders, and the Claude Code agent.
 *
 * To run with a different plugin set, either:
 * 1. Pass `extraXxxPlugins` to add alongside defaults,
 * and flip `storageKind` / `agentKind` to pick a different active one.
 * 2. Call `composeApp` directly with a `pluginRegistry` you built yourself.
 */
export async function composeFsApp(options: ComposeFsOptions = {}): Promise<AppDependencies> {
  const braidHome = options.braidHome ?? process.env.BRAID_HOME ?? join(homedir(), '.braid')
  const apiUrl = options.apiUrl ?? 'http://localhost:4321'

  const secretStore = new FsSecretStore(join(braidHome, 'secrets'))

  const googleClientId = process.env.BRAID_GOOGLE_CLIENT_ID
  const googleClientSecret = process.env.BRAID_GOOGLE_CLIENT_SECRET
  const googleRedirect = process.env.BRAID_GOOGLE_REDIRECT_URI ?? `${apiUrl}/oauth/google/callback`
  const googleLoginRedirect = process.env.BRAID_GOOGLE_LOGIN_REDIRECT_URI ?? `${apiUrl}/auth/google/callback`
  const googleOAuth = googleClientId && googleClientSecret
    ? new GoogleOAuth({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri: googleRedirect,
      loginRedirectUri: googleLoginRedirect,
    })
    : undefined

  const registry = new WorkspaceRegistryFile(join(braidHome, 'workspaces.json'))
  const workspaceRepository = new FsWorkspaceRepository({ registry })

  // Server-side user roster, distinct from any workspace's git history. Auth and ACL belong to the host,
  // not to what a workspace records. Single-user local installs get a `local-user` bootstrapped here,
  // so `userIdMiddleware`'s default actually resolves.
  const userRegistry = new UserRegistryFile(join(braidHome, 'users.json'))
  await ensureLocalUser(userRegistry)

  // Phase B auth. Both files live next to `users.json` under `${BRAID_HOME}`, never inside a workspace,
  // because access control is host state, not a workspace artifact. AccessPolicy reads env at construct time,
  // so a running server needn't restart when env changes mid-flight.
  // Production deployments do restart on config changes, which is why reading once is fine.
  const sessionStore = new SessionStore(join(braidHome, 'sessions.json'))
  const accessPolicyConfig: {
    allowedDomains?: readonly string[]
    allowedEmails?: readonly string[]
    adminEmails?: readonly string[]
  } = {}
  const allowedDomains = parseCsv(process.env.BRAID_ALLOWED_DOMAINS)
  if (allowedDomains)
    accessPolicyConfig.allowedDomains = allowedDomains
  const allowedEmails = parseCsv(process.env.BRAID_ALLOWED_EMAILS)
  if (allowedEmails)
    accessPolicyConfig.allowedEmails = allowedEmails
  const adminEmails = parseCsv(process.env.BRAID_ADMIN_EMAILS)
  if (adminEmails)
    accessPolicyConfig.adminEmails = adminEmails
  const accessPolicy = new AccessPolicy(join(braidHome, 'access.json'), accessPolicyConfig)
  // Back-fill approvedEmails for any pre-existing user accounts,
  // so the dynamic allowlist matches the user roster on boot.
  await ensureApprovedEmails(userRegistry, accessPolicy)
  const studioUrl = process.env.BRAID_STUDIO_URL ?? 'http://localhost:5173'
  const workspaceRoots = async (): Promise<ReadonlyMap<WorkspaceId, AbsolutePath>> => {
    const workspaces = await workspaceRepository.list()
    return new Map(workspaces.map(ws => [ws.id, ws.rootPath]))
  }

  const proposalRepository = new FsProposalRepository({ workspaceRoots })
  const clarifyRepository = new FsClarifyTicketRepository({ workspaceRoots })

  // Plugin registration. Defaults bundle first, then extras,
  // so a caller passing `extraOntologyPlugins: [c4]` gets both ddd and c4.
  // The active one is chosen per-workspace via PRODUCT.md.ontologyId.
  const pluginRegistry = new PluginRegistry()
  pluginRegistry.register(kuzuStoragePlugin)
  for (const plugin of options.extraStoragePlugins ?? [])
    pluginRegistry.register(plugin)

  pluginRegistry.register(dddOntology)
  for (const plugin of options.extraOntologyPlugins ?? [])
    pluginRegistry.register(plugin)

  pluginRegistry.register(gitLoader)
  pluginRegistry.register(createGithubLoader())
  for (const plugin of options.extraSourceLoaderPlugins ?? [])
    pluginRegistry.register(plugin)

  pluginRegistry.register(claudeCodeAgentPlugin)
  for (const plugin of options.extraAgentPlugins ?? [])
    pluginRegistry.register(plugin)

  // The gdrive loader is always registered, so a `kind: gdrive` source doesn't crash at plugin lookup.
  // If OAuth env vars aren't configured, the token resolver throws an actionable error at provision time,
  // so the user knows exactly what to set.
  const oauth = googleOAuth
  pluginRegistry.register(createGoogleDriveLoader({
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

  // Server default agent. A skill overrides kind, model, or effort in its SKILL.md frontmatter,
  // and the runner merges that onto this default at run time.
  const agentKind = AgentKind.parse(options.agentKind ?? 'claude-code')
  const defaultAgent: AgentBindingDescriptor = {
    id: AgentId.parse('claude-code'),
    kind: agentKind,
    model: options.agentModel ?? 'opus',
    effort: options.agentEffort ?? 'high',
    extraArgs: [],
    env: {},
  }

  const runRepository = new FsRunRepository()

  // Built after pluginRegistry is populated, so plugin-shipped SKILL.md files mount under the `plugin` origin,
  // alongside builtins.
  const skillRegistry = new FsSkillRegistry({
    builtinSkillsRoot: builtinSkillsRoot as AbsolutePath,
    pluginRegistry,
  })

  const eventBus = new InMemoryWorkspaceEventBus()
  // Built-in braid-core MCP gateway. Each spawned skill gets a stdio entry,
  // running `uvx openapi-mcp-gateway --transport stdio`. The gateway lifecycle tracks the claude subprocess,
  // with no separate long-running server. It needs `uv` on PATH. If `uv` is missing, the entry is skipped,
  // and skills with `requiredMcpServers: ['braid-core']` surface as not-ready, via SkillManifest.readinessIssuesFor,
  // with a clear pointer.
  const uvxBin = await detectUvx()
  if (!uvxBin) {
    console.warn(
      '[braid] `uv` not found on PATH; the built-in braid-core MCP gateway will not be available. '
      + 'Install via `brew install uv` or https://docs.astral.sh/uv/ to enable.',
    )
  }
  // Build the list of reference dirs symlinked into every skill session:
  // - builtin `shared/` from @braidhq/core,
  // format docs for Proposal, Clarify, Validator, content conventions,
  // and drift-detection guidance.
  // - whatever each registered plugin contributes,
  // for example ontology-ddd's concept doc.
  // Plugin contributions resolve `URL` to an absolute path.
  const pluginReferenceDirs = pluginRegistry.pluginReferenceDirs().map((ref) => {
    const dir = typeof ref.directory === 'string' ? ref.directory : fileURLToPath(ref.directory)
    return { name: ref.name, path: dir as AbsolutePath }
  })
  const skillRunner = new SubprocessSkillRunner({
    skillRegistry,
    buildAgentBinding: descriptor => pluginRegistry.requireAgentPlugin(descriptor.kind).createBinding(descriptor),
    defaultAgent,
    apiUrl,
    runRepository,
    eventBus,
    ...(uvxBin
      ? { coreGateway: { specUrl: `${apiUrl}/openapi.json`, uvxBin } }
      : {}),
    referenceDirs: [
      { name: 'shared', path: join(builtinSkillsRoot, 'shared') as AbsolutePath },
      ...pluginReferenceDirs,
    ],
  })

  // Shared by WorkspaceBootstrapService (boot reconciliation), and HITLService (per-mutation commits).
  const history = new GitWorkspaceHistory()
  const modelSerializer = new FsModelSerializer()
  const bootstrap = new WorkspaceBootstrapService({
    history,
    serializer: modelSerializer,
    modelRepository,
  })

  const workspacesRoot = join(braidHome, 'workspaces') as AbsolutePath
  const userDirectory = new UserDirectoryFromRegistry(userRegistry)
  const deps = composeApp({
    workspaceRepository,
    proposalRepository,
    clarifyRepository,
    modelRepository,
    skillRegistry,
    skillRunner,
    runRepository,
    pluginRegistry,
    eventBus,
    workspacesRoot,
    history,
    modelSerializer,
    bootstrap,
    batchPlanRepository: new FsBatchPlanRepository(),
    intentLister: listIntentItems,
    sourceUnitObservationRepository: new FsSourceUnitObservationRepository({ workspaceRoots }),
    reactorCycleRepository: new FsReactorCycleRepository({ workspaceRoots }),
    sourceUnitDigest: new FsSourceUnitDigest(),
    userDirectory,
  })

  // Pick up workspaces that exist on disk but aren't in the registry. CLI-created ones, scaffold-orphans,
  // copies from another machine. Registry add is idempotent, so this is safe to run on every boot.
  await discoverCanonicalWorkspaces(workspacesRoot, deps.workspaceService)

  // Stamp `local-user` as owner of any workspace with an empty members[],
  // covering older registry entries and freshly discovered workspaces.
  // Owner promotion via `/members` routes can rewrite this later.
  await ensureWorkspaceOwners(registry)

  // Per-workspace failures are logged and tolerated, so one bad dir doesn't block boot.
  const bootstrapLog = createLogger('server').child({ mod: 'workspace-bootstrap' })
  for (const workspace of await deps.workspaceService.list()) {
    try {
      await bootstrap.ensure(workspace)
      // Mark any batch plan left running by a previous process as failed, so the UI doesn't show a phantom spinner.
      // Safe to call even when there is no plan, or when it is already terminal.
      await deps.batchService?.reconcileAfterBoot(workspace.id)
      // Reactor opt-in is per workspace. Subscribe only when the operator flips `reactor.enabled` in PRODUCT.md.
      if (workspace.productManifest.reactor?.enabled)
        await deps.reactorService?.start(workspace.id)
      // Boot-time sync catches deliveries missed while the server was down. Those are unrecoverable,
      // GitHub drops webhook retries after a few hours. So on every boot,
      // fire a `syncOne` per source whose loader supports it. Loaders use a persisted cursor,
      // e.g. `?since=<lastUpdatedAt>`, so a caught-up source costs one empty round-trip,
      // and a stale one fetches only the missed window. Fire-and-forget keeps boot fast. The reactor, subscribed above,
      // picks up the `source.synced` events.
      for (const source of workspace.sources) {
        if (source.kind !== 'filesystem' || !source.loader)
          continue
        void deps.sourceLoaderRunner.syncOne(workspace, source.id).catch((err) => {
          bootstrapLog.warn(
            { workspaceId: workspace.id, sourceId: source.id, err: err instanceof Error ? err.message : String(err) },
            'boot syncOne failed; will retry on next webhook or manual sync',
          )
        })
      }
    }
    catch (err) {
      bootstrapLog.warn({ err, workspaceId: workspace.id }, 'workspace bootstrap failed; skipping')
    }
  }

  // Local trust is the default. Production deployments set `BRAID_LOCAL_TRUST=false` for the Bearer gate.
  // We don't flip the default when Google OAuth env vars are present,
  // because those creds also feed the Drive source loader for provision.
  // A dev workspace pulling from Drive would otherwise hit the Login flow, on every reload.
  const localTrust = parseBoolEnv(process.env.BRAID_LOCAL_TRUST, true)

  return {
    ...deps,
    bootstrap,
    secretStore,
    userRegistry,
    workspaceRegistry: registry,
    sessionStore,
    accessPolicy,
    studioUrl,
    localTrust,
    ...(googleOAuth ? { googleOAuth } : {}),
  }
}

function parseCsv(input: string | undefined): readonly string[] | undefined {
  if (!input)
    return undefined
  const parts = input.split(',').map(s => s.trim()).filter(s => s.length > 0)
  return parts.length > 0 ? parts : undefined
}

/**
 * Resolve the `uvx` binary path by running `uvx --version`. Returns `'uvx'` when the call succeeds.
 * We let `PATH` resolve it at spawn time, so we don't bake an absolute path into mcp-config.
 * Returns `undefined` when `uv` isn't installed. Honours `BRAID_UVX_BIN` for pinning a specific binary,
 * a uv in a non-PATH location, or a stub injected by tests.
 */
async function detectUvx(): Promise<string | undefined> {
  const pinned = process.env.BRAID_UVX_BIN
  const command = pinned && pinned.length > 0 ? pinned : 'uvx'
  return await new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore' })
    child.once('error', () => resolve(undefined))
    child.once('exit', code => resolve(code === 0 ? command : undefined))
  })
}
