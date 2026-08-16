import type { AgentPlugin, OntologyPlugin, SourceLoaderPlugin, StoragePlugin } from '@braidhq/core'
import type { AbsolutePath, AgentBindingDescriptor, AgentEffort, StorageKind, WorkspaceId } from '@braidhq/schema'
import type { AppDependencies } from './composeApp.js'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { claudeCodeAgentPlugin } from '@braidhq/agent-claude-code'
import {
  builtinSkillsRoot,
  NotFoundError,
  PluginRegistry,
  ValidationError,
  WorkspaceBootstrapService,
} from '@braidhq/core'
import { InMemoryWorkspaceEventBus } from '@braidhq/core/in-memory'
import { AgentId, AgentKind, StorageKind as StorageKindSchema } from '@braidhq/schema'
import { createGoogleDriveLoader } from '@braidhq/source-loader-gdrive'
import { gitLoader } from '@braidhq/source-loader-git'
import { createGithubLoader } from '@braidhq/source-loader-github'
import { kuzuStoragePlugin } from '@braidhq/storage-kuzu'
import { authenticated, localTrust } from './authMode.js'
import { composeApp } from './composeApp.js'
import { defaultOntologyPlugins } from './defaultOntologyPlugins.js'
import { parseBoolEnv } from './infrastructure/_shared/env.js'
import { AccessPolicy } from './infrastructure/auth/AccessPolicy.js'
import { FsSessionStore } from './infrastructure/auth/SessionStore.js'
import { FsBatchPlanRepository } from './infrastructure/batch/FsBatchPlanRepository.js'
import { GitWorkspaceHistory } from './infrastructure/history/GitWorkspaceHistory.js'
import { FsClarificationRepository } from './infrastructure/hitl/FsClarificationRepository.js'
import { FsProposalRepository } from './infrastructure/hitl/FsProposalRepository.js'
import { FsModelSerializer } from './infrastructure/model/FsModelSerializer.js'
import { GitHubOAuth } from './infrastructure/oauth/GitHubOAuth.js'
import { GoogleOAuth } from './infrastructure/oauth/GoogleOAuth.js'
import { oauthNamespace } from './infrastructure/oauth/providers.js'
import { FsReactorCycleRepository } from './infrastructure/reactor/FsReactorCycleRepository.js'
import { FsSecretStore, type SecretStore } from './infrastructure/secrets/SecretStore.js'
import { FsRunRepository } from './infrastructure/skill/FsRunRepository.js'
import { BUILTIN_SKILL_NAMESPACE, FsSkillRegistry } from './infrastructure/skill/FsSkillRegistry.js'
import { SubprocessSkillRunner } from './infrastructure/skill/SubprocessSkillRunner.js'
import { FsSourceUnitDigest } from './infrastructure/source/FsSourceUnitDigest.js'
import { FsSourceUnitObservationRepository } from './infrastructure/source/FsSourceUnitObservationRepository.js'
import { listUnitItems, unitBearingRolesOf } from './infrastructure/source/unitScan.js'
import { ensureWorkspaceOwners } from './infrastructure/users/ensureWorkspaceOwners.js'
import { UserDirectoryFromRegistry } from './infrastructure/users/UserDirectoryFromRegistry.js'
import { UserRegistryFile } from './infrastructure/users/UserRegistryFile.js'
import { FsWorkspaceRepository } from './infrastructure/workspace/FsWorkspaceRepository.js'
import { discoverCanonicalWorkspaces } from './infrastructure/workspace/WorkspaceDiscovery.js'
import { WorkspaceRegistryFile } from './infrastructure/workspace/WorkspaceRegistryFile.js'
import { ensureServiceAccount, REACTOR_USER_ID } from './serviceAccounts.js'
import { startupBeforeServe } from './startup.js'

// The coding preset's default plugin identities, its worldview in one place.
// A caller overrides any of these through ComposeFsOptions,
// or drops to composeApp with its own PluginRegistry for a different worldview.
const DEFAULT_STORAGE_KIND = 'kuzu'
const DEFAULT_AGENT_KIND = 'claude-code'
const DEFAULT_AGENT_MODEL = 'opus'
const DEFAULT_AGENT_EFFORT = 'high'

export interface ComposeFsOptions {
  // Paths and URLs.
  // `braidHome` defaults to `$BRAID_HOME` or `~/.braid`.
  // `apiUrl` is what the server reports to spawned subprocesses for callbacks.
  readonly braidHome?: string
  readonly apiUrl?: string

  // Preset default overrides, each falls to the `DEFAULT_*` constant above.
  // `storageKind` also reads `BRAID_STORAGE_KIND`, resolved against the registry.
  readonly storageKind?: StorageKind
  readonly agentKind?: AgentKind
  readonly agentModel?: string
  readonly agentEffort?: AgentEffort

  // Extra plugins registered alongside the preset defaults, not replacing them.
  // The active ontology, storage, and agent stay chosen per-workspace,
  // so a caller registers a plugin here, then a workspace opts into it.
  readonly extraStoragePlugins?: readonly StoragePlugin[]
  readonly extraOntologyPlugins?: readonly OntologyPlugin[]
  readonly extraSourceLoaderPlugins?: readonly SourceLoaderPlugin[]
  readonly extraAgentPlugins?: readonly AgentPlugin[]
}

/**
 * Opinionated production composition, the coding preset.
 * Filesystem-persists workspaces, proposals, and clarifications,
 * and bundles Kuzu storage, the DDD ontology, the git, github, and drive
 * loaders, and the claude-code agent.
 *
 * To run a different plugin set, either pass `extraXxxPlugins` and flip
 * `storageKind` or `agentKind`, or call `composeApp` with your own registry.
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

  const githubClientId = process.env.BRAID_GITHUB_CLIENT_ID
  const githubClientSecret = process.env.BRAID_GITHUB_CLIENT_SECRET
  const githubRedirect = process.env.BRAID_GITHUB_REDIRECT_URI ?? `${apiUrl}/oauth/github/callback`
  const githubOAuth = githubClientId && githubClientSecret
    ? new GitHubOAuth({
      clientId: githubClientId,
      clientSecret: githubClientSecret,
      redirectUri: githubRedirect,
    })
    : undefined

  const registry = new WorkspaceRegistryFile(join(braidHome, 'workspaces.json'))
  const workspaceRepository = new FsWorkspaceRepository({ registry })

  // Server-side user roster, distinct from any workspace's git history.
  // Auth and ACL belong to the host, not to what a workspace records.
  const userRegistry = new UserRegistryFile(join(braidHome, 'users.json'))

  // Auth state. Both files live next to `users.json` under `${BRAID_HOME}`,
  // never inside a workspace,
  // because access control is host state, not a workspace artifact.
  // AccessPolicy reads env at construct time.
  // Production deployments restart on config changes, so reading once is fine.
  const sessionStore = new FsSessionStore(join(braidHome, 'sessions.json'))
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
  // Boot, part one, provision host identity, who may use this server.
  // Local trust is the default.
  // Production sets `BRAID_LOCAL_TRUST=false` to require real authentication.
  // We do not flip the default when Google OAuth env is present,
  // those creds also feed the Drive loader,
  // and a dev pulling from Drive should not hit Login on every reload.
  const authMode = parseBoolEnv(process.env.BRAID_LOCAL_TRUST, true) ? localTrust : authenticated
  // Local trust seeds `local-user`, authenticated mode syncs the login allowlist.
  await authMode.provision({ userRegistry, accessPolicy })
  // The reactor is an autonomous component, so it seeds its own service account.
  // Its kind=service rides onto every proposal it submits,
  // so the HITL views classify it without a read-time lookup.
  await ensureServiceAccount(userRegistry, REACTOR_USER_ID, 'Reactor')
  const studioUrl = process.env.BRAID_STUDIO_URL ?? 'http://localhost:5173'
  const workspaceRoots = async (): Promise<ReadonlyMap<WorkspaceId, AbsolutePath>> => {
    const workspaces = await workspaceRepository.list()
    return new Map(workspaces.map(ws => [ws.id, ws.rootPath]))
  }

  const proposalRepository = new FsProposalRepository({ workspaceRoots })
  const clarificationRepository = new FsClarificationRepository({ workspaceRoots })

  // Plugin registration. Defaults bundle first, then extras,
  // so a caller passing `extraOntologyPlugins: [c4]` gets both ddd and c4.
  // The active one is chosen per-workspace via PRODUCT.md.ontologyId.
  const pluginRegistry = new PluginRegistry()
  pluginRegistry.register(kuzuStoragePlugin)
  for (const plugin of options.extraStoragePlugins ?? [])
    pluginRegistry.register(plugin)

  for (const plugin of defaultOntologyPlugins())
    pluginRegistry.register(plugin)
  for (const plugin of options.extraOntologyPlugins ?? [])
    pluginRegistry.register(plugin)

  pluginRegistry.register(gitLoader)
  pluginRegistry.register(createGithubLoader({
    resolveAccessToken: makeOAuthTokenResolver({
      secretStore,
      namespace: oauthNamespace('github'),
      refresh: githubOAuth ? refreshToken => githubOAuth.refreshAccessToken(refreshToken) : undefined,
      notConfigured: sourceId => new ValidationError(
        `GitHub source "${sourceId}" cannot be loaded: set BRAID_GITHUB_CLIENT_ID and BRAID_GITHUB_CLIENT_SECRET on the server, restart, then reconnect.`,
      ),
      notConnected: (workspaceId, sourceId) => new NotFoundError(
        `GitHub source "${sourceId}" on workspace "${workspaceId}" is not connected. `
        + `Connect it from the source settings in Studio.`,
      ),
    }),
  }))
  for (const plugin of options.extraSourceLoaderPlugins ?? [])
    pluginRegistry.register(plugin)

  pluginRegistry.register(claudeCodeAgentPlugin)
  for (const plugin of options.extraAgentPlugins ?? [])
    pluginRegistry.register(plugin)

  // The gdrive loader is always registered,
  // so a `kind: gdrive` source doesn't crash at plugin lookup.
  // If OAuth env vars aren't configured,
  // the token resolver throws an actionable error at provision time,
  // so the user knows exactly what to set.
  pluginRegistry.register(createGoogleDriveLoader({
    resolveAccessToken: makeOAuthTokenResolver({
      secretStore,
      namespace: oauthNamespace('google'),
      refresh: googleOAuth ? refreshToken => googleOAuth.refreshAccessToken(refreshToken) : undefined,
      notConfigured: sourceId => new ValidationError(
        `Google Drive source "${sourceId}" cannot be loaded: set BRAID_GOOGLE_CLIENT_ID and BRAID_GOOGLE_CLIENT_SECRET on the server, restart, then re-sync.`,
      ),
      notConnected: (workspaceId, sourceId) => new NotFoundError(
        `Google Drive source "${sourceId}" on workspace "${workspaceId}" is not connected. `
        + `Connect it from the source settings in Studio.`,
      ),
    }),
  }))

  // Resolve the active storage plugin and ask it for a ModelRepository.
  const storageKind = StorageKindSchema.parse(
    options.storageKind ?? process.env.BRAID_STORAGE_KIND ?? DEFAULT_STORAGE_KIND,
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

  // Server default agent.
  // A skill overrides kind, model, or effort in its SKILL.md frontmatter,
  // and the runner merges that onto this default at run time.
  const agentKind = AgentKind.parse(options.agentKind ?? DEFAULT_AGENT_KIND)
  const defaultAgent: AgentBindingDescriptor = {
    id: AgentId.parse(DEFAULT_AGENT_KIND),
    kind: agentKind,
    model: options.agentModel ?? DEFAULT_AGENT_MODEL,
    effort: options.agentEffort ?? DEFAULT_AGENT_EFFORT,
    extraArgs: [],
    env: {},
  }

  const runRepository = new FsRunRepository()

  // Built after pluginRegistry is populated,
  // so plugin-shipped SKILL.md files mount under the `plugin` origin,
  // alongside builtins.
  const skillRegistry = new FsSkillRegistry({
    builtinSkillsRoot: builtinSkillsRoot as AbsolutePath,
    pluginRegistry,
  })

  const eventBus = new InMemoryWorkspaceEventBus()
  // Built-in braid-core MCP gateway. Each spawned skill gets a stdio entry,
  // running `uvx openapi-mcp-gateway --transport stdio`.
  // The gateway lifecycle tracks the claude subprocess,
  // with no separate long-running server, and needs `uv` on PATH.
  // If `uv` is missing, the entry is skipped.
  // Skills that require `braid-core` then surface as not-ready,
  // via SkillManifest.readinessIssuesFor, with a clear pointer.
  const uvxBin = await detectUvx()
  if (!uvxBin) {
    console.warn(
      '[braid] `uv` not found on PATH; the built-in braid-core MCP gateway will not be available. '
      + 'Install via `brew install uv` or https://docs.astral.sh/uv/ to enable.',
    )
  }
  // Reference dirs mounted into every skill session,
  // keyed by the namespace that owns them, so each stays paired with its skills.
  // Core's `shared/` lands under the builtin namespace,
  // carrying the Proposal, Clarification, Validator, batch-plan, drift contracts.
  // Each plugin's own dir lands under its namespace,
  // the DDD concept doc under `ddd` for example.
  // Plugin contributions resolve `URL` to an absolute path.
  const pluginReferenceDirs = pluginRegistry.pluginReferenceDirs().map((ref) => {
    const dir = typeof ref.directory === 'string' ? ref.directory : fileURLToPath(ref.directory)
    return { skillNamespace: ref.skillNamespace, path: dir as AbsolutePath }
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
      { skillNamespace: BUILTIN_SKILL_NAMESPACE, path: join(builtinSkillsRoot, 'shared') as AbsolutePath },
      ...pluginReferenceDirs,
    ],
    // Resolve the workspace's active ontology to its declared source roles.
    // The runner serialises these into BRAID_SOURCE_ROLES,
    // so a generic prompt reads the role vocabulary instead of naming role ids.
    resolveSourceRoles: (workspace) => {
      const ontology = pluginRegistry.findOntology(workspace.productManifest.ontologyId)
      return ontology?.sourceRoles ?? []
    },
  })

  // Shared by WorkspaceBootstrapService (boot reconciliation),
  // and HITLService (per-mutation commits).
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
    clarificationRepository,
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
    unitLister: workspace => listUnitItems(workspace, unitBearingRolesOf(pluginRegistry, workspace)),
    // The reactor has no human caller, so it acts as the `reactor` service account,
    // minting a short-lived session so its API calls authenticate.
    reactorToken: async () => (await sessionStore.issue(REACTOR_USER_ID, { ttlSeconds: 3600 })).token,
    sourceUnitObservationRepository: new FsSourceUnitObservationRepository({ workspaceRoots }),
    reactorCycleRepository: new FsReactorCycleRepository({ workspaceRoots }),
    sourceUnitDigest: new FsSourceUnitDigest(),
    userDirectory,
    authMode,
  })

  // Boot, part two, reconcile workspaces, register then boot each.
  // Pick up workspaces on disk but not in the registry,
  // such as CLI-created ones, scaffold orphans, or copies from another machine.
  // Registry add is idempotent, safe on every boot.
  await discoverCanonicalWorkspaces(workspacesRoot, deps.workspaceService)

  // Give any workspace with an empty members[] its default owner,
  // covering older registry entries and freshly discovered workspaces.
  // Owner promotion via `/members` routes can rewrite this later.
  await ensureWorkspaceOwners(registry, authMode.defaultPrincipal)

  // Blocking per-workspace startup, provision, recover, subscribe, catch-up sync.
  // See startup.ts, the single home for boot steps.
  await startupBeforeServe(deps)

  return {
    ...deps,
    bootstrap,
    secretStore,
    userRegistry,
    workspaceRegistry: registry,
    sessionStore,
    accessPolicy,
    studioUrl,
    ...(googleOAuth ? { googleOAuth } : {}),
    ...(githubOAuth ? { githubOAuth } : {}),
  }
}

/**
 * Build a token resolver for an OAuth-backed loader.
 * Returns a still-valid access token, or refreshes when it is near expiry.
 * A failed refresh flags the source `needsAuth` so Studio prompts a reconnect,
 * a fresh refresh clears that flag.
 * `refresh` is absent when the provider's server env is unset,
 * then the resolver throws `notConfigured`.
 */
function makeOAuthTokenResolver<R extends { accessToken: string, expiresAt: string }>(deps: {
  secretStore: SecretStore
  namespace: string
  refresh: ((refreshToken: string) => Promise<R>) | undefined
  notConfigured: (sourceId: string) => Error
  notConnected: (workspaceId: string, sourceId: string) => Error
}): (context: { workspaceId: string, sourceId: string }) => Promise<string> {
  return async ({ workspaceId, sourceId }) => {
    if (!deps.refresh)
      throw deps.notConfigured(sourceId)
    const key = `${workspaceId}--${sourceId}`
    const stored = await deps.secretStore.read<{ accessToken: string, refreshToken: string, expiresAt: string }>(deps.namespace, key)
    if (!stored)
      throw deps.notConnected(workspaceId, sourceId)
    // 60-second skew, so we don't hand out a token about to expire mid-request.
    const stillValidUntil = new Date(stored.expiresAt).getTime() - 60_000
    if (Date.now() < stillValidUntil)
      return stored.accessToken
    try {
      // A fresh set clears any prior needs-auth marker.
      // GitHub rotates its refresh token, so spreading `refreshed` keeps it.
      const refreshed = await deps.refresh(stored.refreshToken)
      await deps.secretStore.write(deps.namespace, key, { ...stored, ...refreshed, needsAuth: false })
      return refreshed.accessToken
    }
    catch (error) {
      // The refresh token is dead, revoked or expired.
      // Flag the source so Studio prompts a reconnect instead of only logging.
      await deps.secretStore.write(deps.namespace, key, { ...stored, needsAuth: true })
      throw error
    }
  }
}

function parseCsv(input: string | undefined): readonly string[] | undefined {
  if (!input)
    return undefined
  const parts = input.split(',').map(s => s.trim()).filter(s => s.length > 0)
  return parts.length > 0 ? parts : undefined
}

// Resolve the `uvx` binary path by running `uvx --version`.
// Returns `'uvx'` when the call succeeds.
// We let `PATH` resolve it at spawn time,
// so we don't bake an absolute path into mcp-config.
// Returns `undefined` when `uv` isn't installed.
// Honours `BRAID_UVX_BIN` for pinning a specific binary, a uv off PATH,
// or a stub injected by tests.
async function detectUvx(): Promise<string | undefined> {
  const pinned = process.env.BRAID_UVX_BIN
  const command = pinned && pinned.length > 0 ? pinned : 'uvx'
  return await new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore' })
    child.once('error', () => resolve(undefined))
    child.once('exit', code => resolve(code === 0 ? command : undefined))
  })
}
