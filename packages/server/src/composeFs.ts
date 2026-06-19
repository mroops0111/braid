import type { AgentPlugin, OntologyPlugin, SourceLoaderPlugin, StoragePlugin } from '@braidhq/core'
import type { AbsolutePath, AgentEffort, StorageKind, WorkspaceId } from '@braidhq/schema'
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
  InMemoryWorkspaceEventBus,
  NotFoundError,
  PluginRegistry,
  ValidationError,
  WorkspaceBootstrap,
} from '@braidhq/core'
import { dddOntology } from '@braidhq/ontology-ddd'
import { AgentId, AgentKind, StorageKind as StorageKindSchema } from '@braidhq/schema'
import { GoogleDriveLoader } from '@braidhq/source-loader-gdrive'
import { GitLoader } from '@braidhq/source-loader-git'
import { GithubLoader } from '@braidhq/source-loader-github'
import { kuzuStoragePlugin } from '@braidhq/storage-kuzu'
import { composeApp } from './composition.js'
import { SubprocessSkillRunner } from './infrastructure/agent/SubprocessSkillRunner.js'
import { AccessPolicy } from './infrastructure/auth/AccessPolicy.js'
import { ensureApprovedEmails } from './infrastructure/auth/ensureApprovedEmails.js'
import { SessionStore } from './infrastructure/auth/SessionStore.js'
import { parseBoolEnv } from './infrastructure/env.js'
import { FsBatchPlanRepository } from './infrastructure/fs/FsBatchPlanRepository.js'
import { FsClarifyTicketRepository } from './infrastructure/fs/FsClarifyTicketRepository.js'
import { FsDecisionRepository } from './infrastructure/fs/FsDecisionRepository.js'
import { FsGraphSerializer } from './infrastructure/fs/FsGraphSerializer.js'
import { FsProposalRepository } from './infrastructure/fs/FsProposalRepository.js'
import { FsRunRepository } from './infrastructure/fs/FsRunRepository.js'
import { FsSkillRegistry } from './infrastructure/fs/FsSkillRegistry.js'
import { FsSourceUnitDigest } from './infrastructure/fs/FsSourceUnitDigest.js'
import { FsSourceUnitStateRepository } from './infrastructure/fs/FsSourceUnitStateRepository.js'
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
   *   - source-loader: `GitLoader`, `GithubLoader`, `GoogleDriveLoader`
   *     (gdrive throws an actionable error at ingest if OAuth env is missing;
   *     github falls back to anonymous if `${GH_TOKEN}` is unset, subject to
   *     the 60 req/h public rate limit)
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

  // Server-side user roster. Distinct from any workspace's git history:
  // Auth and ACL belong to the host, not to the product knowledge a
  // workspace records. Single-user local installs get a `local-user`
  // bootstrapped here so `userIdMiddleware`'s default actually resolves.
  const userRegistry = new UserRegistryFile(join(braidHome, 'users.json'))
  await ensureLocalUser(userRegistry)

  // Phase B auth. Both files live next to `users.json` under `${BRAID_HOME}`;
  // never inside a workspace because access control is host state, not
  // workspace artifact. AccessPolicy reads env at construct time so a
  // running server doesn't need to be restarted when env changes mid-flight
  // — but production deployments do restart on config changes, which is
  // why this is fine to read once.
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
  // Back-fill approvedEmails for any pre-existing user accounts so the
  // dynamic allowlist matches the user roster on boot.
  await ensureApprovedEmails(userRegistry, accessPolicy)
  const studioUrl = process.env.BRAID_STUDIO_URL ?? 'http://localhost:5173'
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
  pluginRegistry.register(new GithubLoader())
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
  const agentKind = AgentKind.parse(options.agentKind ?? 'claude-code')
  const agentBinding = pluginRegistry.requireAgentPlugin(agentKind).createBinding({
    id: AgentId.parse('default'),
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
  // Built-in braid-core MCP gateway: each spawned skill gets a stdio
  // entry that runs `uvx openapi-mcp-gateway` with --transport stdio.
  // The gateway lifecycle tracks the claude subprocess; no separate
  // long-running server. Requires `uv` to be installed on PATH; if it
  // isn't, skip the entry silently — skills with
  // `requiredMcpServers: ['braid-core']` will surface as not-ready
  // via SkillManifest.readinessIssuesFor, with a clear pointer.
  const uvxBin = await detectUvx()
  if (!uvxBin) {
    console.warn(
      '[braid] `uv` not found on PATH; the built-in braid-core MCP gateway will not be available. '
      + 'Install via `brew install uv` or https://docs.astral.sh/uv/ to enable.',
    )
  }
  // Build the list of reference dirs symlinked into every skill session:
  //   - builtin `shared/` from @braidhq/core (Proposal / Clarify / Validator
  //     format docs, content conventions, drift-detection guidance)
  //   - whatever each registered plugin contributes (e.g. ontology-ddd's
  //     concept doc). Plugin contributions resolve `URL` -> absolute path.
  const pluginReferenceDirs = pluginRegistry.pluginReferenceDirs().map((ref) => {
    const dir = typeof ref.directory === 'string' ? ref.directory : fileURLToPath(ref.directory)
    return { name: ref.name, path: dir as AbsolutePath }
  })
  const skillRunner = new SubprocessSkillRunner({
    skillRegistry,
    agentBinding,
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

  // Shared by WorkspaceBootstrap (boot reconciliation) and HITLService (per-mutation commits).
  const history = new GitWorkspaceHistory()
  const graphSerializer = new FsGraphSerializer()
  const bootstrap = new WorkspaceBootstrap({
    history,
    serializer: graphSerializer,
    modelRepository,
  })

  const workspacesRoot = join(braidHome, 'workspaces') as AbsolutePath
  const userDirectory = new UserDirectoryFromRegistry(userRegistry)
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
    history,
    graphSerializer,
    bootstrap,
    batchPlanRepository: new FsBatchPlanRepository(),
    intentLister: listIntentItems,
    sourceUnitStateRepository: new FsSourceUnitStateRepository({ workspaceRoots }),
    sourceUnitDigest: new FsSourceUnitDigest(),
    userDirectory,
  })

  // Pick up workspaces that exist on disk but aren't in the registry:
  // CLI-created ones, scaffold-orphans, copies-from-another-machine.
  // Registry add is idempotent so this is safe to run on every boot.
  await discoverCanonicalWorkspaces(workspacesRoot, deps.workspaceService)

  // Phase C migration: stamp `local-user` as owner of any workspace
  // whose members[] is still empty (pre-Phase-C registry entries,
  // freshly discovered workspaces). Owner promotion via `/members`
  // routes can rewrite this later.
  await ensureWorkspaceOwners(registry)

  // Per-workspace failures are logged and tolerated so one bad dir doesn't block boot.
  const bootstrapLog = createLogger('server').child({ mod: 'workspace-bootstrap' })
  for (const workspace of await deps.workspaceService.list()) {
    try {
      await bootstrap.ensure(workspace)
      // Mark any batch plan left running by a previous process as failed so
      // the UI doesn't show a phantom spinner. Safe to call even when there
      // is no plan or when the plan is already terminal.
      await deps.batchService?.reconcileAfterBoot(workspace.id)
    }
    catch (err) {
      bootstrapLog.warn({ err, workspaceId: workspace.id }, 'workspace bootstrap failed; skipping')
    }
  }

  // Local trust is the default; production deployments opt into the
  // Bearer-token gate by setting `BRAID_LOCAL_TRUST=false`. We deliberately
  // DON'T flip the default just because Google OAuth env vars are
  // present — those same creds are also used by the Drive source
  // loader for ingest, so a local dev workspace pulling from Drive
  // would otherwise get pushed into the Login flow on every reload.
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
 * Resolve the `uvx` binary path by running `uvx --version`. Returns
 * `'uvx'` when the call succeeds (we let `PATH` resolve it at spawn
 * time so we don't bake an absolute path into mcp-config), or
 * `undefined` when `uv` isn't installed. Honours `BRAID_UVX_BIN` for
 * pinning a specific binary (uv in a non-PATH location, or tests
 * that want to inject a stub).
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
