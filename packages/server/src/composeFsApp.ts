import type { AgentPlugin, OntologyPlugin, SourceLoaderPlugin, StoragePlugin } from '@braidhq/core'
import type { AbsolutePath, AgentBindingDescriptor, AgentEffort, OntologyId, StorageKind, WorkspaceId } from '@braidhq/schema'
import type { AppDependencies } from './composeApp.js'
import type { LoginProvider } from './infrastructure/auth/LoginProvider.js'
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
import { createMcpLoader } from '@braidhq/source-loader-mcp'
import { kuzuStoragePlugin } from '@braidhq/storage-kuzu'
import { authenticated, localTrust } from './authMode.js'
import { composeApp } from './composeApp.js'
import { defaultOntologyPlugins } from './defaultOntologyPlugins.js'
import { parseBoolEnv } from './infrastructure/_shared/env.js'
import { withoutTrailingSlash } from './infrastructure/_shared/urls.js'
import { AccessPolicy } from './infrastructure/auth/AccessPolicy.js'
import { chooseLoginMode } from './infrastructure/auth/loginMode.js'
import { FsSessionStore } from './infrastructure/auth/SessionStore.js'
import { FsBatchPlanRepository } from './infrastructure/batch/FsBatchPlanRepository.js'
import { FsEmbeddingRepository } from './infrastructure/embedding/FsEmbeddingRepository.js'
import { OpenAiCompatibleEmbedder } from './infrastructure/embedding/OpenAiCompatibleEmbedder.js'
import { GitWorkspaceHistory } from './infrastructure/history/GitWorkspaceHistory.js'
import { FsClarificationRepository } from './infrastructure/hitl/FsClarificationRepository.js'
import { FsProposalRepository } from './infrastructure/hitl/FsProposalRepository.js'
import { McpGatewayProcess } from './infrastructure/mcp/McpGatewayProcess.js'
import { resolveMcpGateway } from './infrastructure/mcp/mcpGatewaySettings.js'
import { FsModelSerializer } from './infrastructure/model/FsModelSerializer.js'
import { GitHubOAuth } from './infrastructure/oauth/GitHubOAuth.js'
import { GoogleOAuth } from './infrastructure/oauth/GoogleOAuth.js'
import { oauthNamespace } from './infrastructure/oauth/providers.js'
import { OidcLoginProvider } from './infrastructure/oidc/OidcLoginProvider.js'
import { OidcTokenVerifier } from './infrastructure/oidc/OidcTokenVerifier.js'
import { FsReactorCycleRepository } from './infrastructure/reactor/FsReactorCycleRepository.js'
import { FsSecretStore, type SecretStore } from './infrastructure/secrets/SecretStore.js'
import { FsRunRepository } from './infrastructure/skill/FsRunRepository.js'
import { BUILTIN_SKILL_NAMESPACE, FsSkillRegistry } from './infrastructure/skill/FsSkillRegistry.js'
import { SubprocessSkillRunner } from './infrastructure/skill/SubprocessSkillRunner.js'
import { FsSourceSyncStateRepository } from './infrastructure/source/FsSourceSyncStateRepository.js'
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
// or hands composeFsAppWithRegistry its own PluginRegistry,
// for a different worldview over the same runtime.
const DEFAULT_STORAGE_KIND = 'kuzu'
const DEFAULT_AGENT_KIND = 'claude-code'
const DEFAULT_AGENT_MODEL = 'opus'
const DEFAULT_AGENT_EFFORT = 'high'
// What a self-hosted stack most often has pulled already.
// Multilingual too, so a query reaches a node named in another language.
const DEFAULT_EMBEDDING_MODEL = 'bge-m3:latest'

// How the embedding client paces itself. Fixed rather than configurable,
// since a deployment has nothing to base a different number on.
const EMBEDDING_BATCH_SIZE = 16
// A cold server loads the model on the first call.
// On a multi-gigabyte model that outlasts any default HTTP timeout.
const EMBEDDING_TIMEOUT_MS = 300_000

export interface ComposeFsRuntimeOptions {
  // Paths and URLs.
  // `braidHome` defaults to `$BRAID_HOME` or `~/.braid`.
  // `apiUrl` is the address callers outside the host reach this server at,
  // so it is what OAuth redirects, webhook URLs,
  // and the OpenAPI `servers[]` block name.
  // `loopbackApiUrl` is the address a subprocess on this host uses,
  // which a deployment behind a proxy cannot always reach by its public name.
  // It defaults to `apiUrl`, which is right whenever the two coincide.
  readonly braidHome?: string
  readonly apiUrl?: string
  readonly loopbackApiUrl?: string

  // Preset default overrides, each falls to the `DEFAULT_*` constant above.
  // `storageKind` also reads `BRAID_STORAGE_KIND`, resolved against the registry.
  readonly storageKind?: StorageKind
  readonly agentKind?: AgentKind
  readonly agentModel?: string
  readonly agentEffort?: AgentEffort

  // What a scaffold writes when its manifest names no ontology.
  // Unset falls to the sole registered ontology,
  // so a single-ontology build never has to repeat its own id.
  readonly defaultOntologyId?: OntologyId
}

export interface ExtraPluginOptions {
  // Extra plugins registered alongside the preset defaults, not replacing them.
  // The active ontology, storage, and agent stay chosen per-workspace,
  // so a caller registers a plugin here, then a workspace opts into it.
  readonly extraStoragePlugins?: readonly StoragePlugin[]
  readonly extraOntologyPlugins?: readonly OntologyPlugin[]
  readonly extraSourceLoaderPlugins?: readonly SourceLoaderPlugin[]
  readonly extraAgentPlugins?: readonly AgentPlugin[]
}

export type ComposeFsOptions = ComposeFsRuntimeOptions & ExtraPluginOptions

/**
 * What the fs runtime has already built by the time it asks for a registry.
 * The OAuth-backed loaders need the secret store and the provider clients,
 * both derived from `braidHome` and `apiUrl`, so a caller-supplied plugin
 * reads them from here rather than rebuilding them.
 * `googleOAuth` and `githubOAuth` are absent when their env is unset.
 */
export interface FsRuntimeContext {
  readonly braidHome: string
  readonly apiUrl: string
  readonly secretStore: SecretStore
  readonly googleOAuth?: GoogleOAuth
  readonly githubOAuth?: GitHubOAuth
}

/** Yields the registry the fs runtime resolves storage, agent, and ontology from. */
export type PluginRegistryFactory = (context: FsRuntimeContext) => PluginRegistry | Promise<PluginRegistry>

/**
 * The source loaders a default Braid build ships with.
 * Exported so a third-party composition can take the git, github,
 * and drive loaders without inheriting the rest of the coding preset.
 */
export function defaultSourceLoaderPlugins(context: FsRuntimeContext): readonly SourceLoaderPlugin[] {
  const { secretStore, githubOAuth, googleOAuth } = context
  return [
    gitLoader,
    createGithubLoader({
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
    }),
    // Drive is listed even when its OAuth env is unset,
    // so a `kind: gdrive` source resolves a loader instead of failing lookup.
    // The token resolver then throws at provision time,
    // naming the env vars the user has to set.
    createGoogleDriveLoader({
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
    }),
    // Reaches whatever an MCP server exposes,
    // so the tracker or wiki a team already runs becomes a source,
    // without a package per product.
    // Its credential rides in the source's own config,
    // so there is nothing for the composition root to inject.
    createMcpLoader(),
  ]
}

/**
 * The registry `composeFsApp` runs on, the coding preset's whole bundle.
 * Defaults register first, then the caller's extras,
 * so `extraOntologyPlugins: [c4]` yields both ddd and c4.
 * The active one is chosen per-workspace via PRODUCT.md.ontologyId.
 */
export function defaultPluginRegistry(context: FsRuntimeContext, options: ExtraPluginOptions = {}): PluginRegistry {
  const pluginRegistry = new PluginRegistry()
  pluginRegistry.register(kuzuStoragePlugin)
  for (const plugin of options.extraStoragePlugins ?? [])
    pluginRegistry.register(plugin)

  for (const plugin of defaultOntologyPlugins())
    pluginRegistry.register(plugin)
  for (const plugin of options.extraOntologyPlugins ?? [])
    pluginRegistry.register(plugin)

  for (const plugin of defaultSourceLoaderPlugins(context))
    pluginRegistry.register(plugin)
  for (const plugin of options.extraSourceLoaderPlugins ?? [])
    pluginRegistry.register(plugin)

  pluginRegistry.register(claudeCodeAgentPlugin)
  for (const plugin of options.extraAgentPlugins ?? [])
    pluginRegistry.register(plugin)

  return pluginRegistry
}

/**
 * Opinionated production composition, the coding preset.
 * Filesystem-persists workspaces, proposals, and clarifications,
 * and bundles Kuzu storage, the DDD ontology, the git, github,
 * and drive loaders, and the claude-code agent.
 *
 * To run a different plugin set, either pass `extraXxxPlugins` and flip
 * `storageKind` or `agentKind`, or hand `composeFsAppWithRegistry` a registry
 * holding only the plugins you want.
 */
export async function composeFsApp(options: ComposeFsOptions = {}): Promise<AppDependencies> {
  return composeFsAppWithRegistry(context => defaultPluginRegistry(context, options), options)
}

/**
 * The same filesystem runtime as `composeFsApp`, over a registry you build.
 * Storage and agent resolve from whatever `buildRegistry` registered, under
 * `storageKind` and `agentKind`, so a composition that omits the coding
 * preset's ontology and loaders still gets the subprocess skill runner, the
 * fs unit lister, and every fs repository, and so a batch runs unchanged.
 */
export async function composeFsAppWithRegistry(
  buildRegistry: PluginRegistryFactory,
  options: ComposeFsRuntimeOptions = {},
): Promise<AppDependencies> {
  const braidHome = options.braidHome ?? process.env.BRAID_HOME ?? join(homedir(), '.braid')
  // Everything below appends a path to this,
  // so a trailing slash would double the separator,
  // and leave an OAuth redirect no console entry matches.
  const apiUrl = withoutTrailingSlash(options.apiUrl ?? 'http://localhost:4321')
  const loopbackApiUrl = withoutTrailingSlash(options.loopbackApiUrl ?? apiUrl)

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
  const studioUrl = process.env.BRAID_STUDIO_URL ?? 'http://localhost:5173'
  // Local trust is the default.
  // Production sets `BRAID_LOCAL_TRUST=false` to require real authentication.
  // We do not flip the default when Google OAuth env is present,
  // those creds also feed the Drive loader,
  // and a dev pulling from Drive should not hit Login on every reload.
  const locallyTrusted = parseBoolEnv(process.env.BRAID_LOCAL_TRUST, true)
  assertLocalTrustIsLocal(locallyTrusted, studioUrl)
  const authMode = locallyTrusted ? localTrust : authenticated
  // Local trust seeds `local-user`, authenticated mode syncs the login allowlist.
  await authMode.provision({ userRegistry, accessPolicy })
  // The reactor is an autonomous component, so it seeds its own service account.
  // Its kind=service rides onto every proposal it submits,
  // so the HITL views classify it without a read-time lookup.
  await ensureServiceAccount(userRegistry, REACTOR_USER_ID, 'Reactor')
  // A deployment that names an authorization server accepts its tokens,
  // as well as the sessions Braid issues,
  // so a programmatic client has a door that does not involve a browser.
  // Unset leaves Braid exactly as it was.
  const oidcIssuer = process.env.BRAID_OIDC_ISSUER
  const oidcAudience = process.env.BRAID_OIDC_AUDIENCE ?? apiUrl
  // One way in, never two.
  // An authorization server displaces the Google client rather than joining it,
  // so a person has one identity whichever door they use,
  // and Google is configured once at the issuer instead of twice.
  // Without an issuer this falls back to the Google client,
  // which is what a laptop install and a small deployment run on.
  const loginMode = chooseLoginMode(process.env, { googleConfigured: googleOAuth !== undefined })
  const loginProviders: LoginProvider[]
    = loginMode.kind === 'oidc'
      ? [new OidcLoginProvider({
          issuer: loginMode.issuer,
          clientId: loginMode.clientId,
          clientSecret: loginMode.clientSecret,
          redirectUri: `${apiUrl}/auth/oidc/callback`,
        })]
      : loginMode.kind === 'google' && googleOAuth
        ? [googleOAuth]
        : []
  if (loginMode.kind === 'none' && authMode.requiresAuth)
    console.warn(`[braid] Nobody can sign in. ${loginMode.reason}`)

  const accessTokenVerifiers = oidcIssuer
    ? [new OidcTokenVerifier({ issuer: oidcIssuer, audience: oidcAudience, userRegistry, accessPolicy })]
    : []

  // Serving Studio ourselves puts the UI and the API on one origin,
  // so the browser never reaches for CORS on the path that matters.
  const studioRoot = process.env.BRAID_STUDIO_ROOT
  // A deployment that sets its own studio origin has left dev behind,
  // so localhost stops being allowed unless it is named explicitly.
  const corsOrigins = resolveCorsOrigins(studioUrl, process.env.BRAID_CORS_ORIGINS)
  const workspaceRoots = async (): Promise<ReadonlyMap<WorkspaceId, AbsolutePath>> => {
    const workspaces = await workspaceRepository.list()
    return new Map(workspaces.map(ws => [ws.id, ws.rootPath]))
  }

  const proposalRepository = new FsProposalRepository({ workspaceRoots })
  const clarificationRepository = new FsClarificationRepository({ workspaceRoots })

  const pluginRegistry = await buildRegistry({
    braidHome,
    apiUrl,
    secretStore,
    ...(googleOAuth ? { googleOAuth } : {}),
    ...(githubOAuth ? { githubOAuth } : {}),
  })

  // Resolve the active storage plugin and ask it for a ModelRepository.
  const storageKind = StorageKindSchema.parse(
    options.storageKind ?? process.env.BRAID_STORAGE_KIND ?? DEFAULT_STORAGE_KIND,
  )
  const resolveWorkspaceRoot = async (workspaceId: WorkspaceId): Promise<string> => {
    const roots = await workspaceRoots()
    const root = roots.get(workspaceId)
    if (!root)
      throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
    return root
  }
  const pluginContext = {
    workspaceRootPath: braidHome,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }
  const modelRepository = await pluginRegistry.requireStoragePlugin(storageKind).createModelRepository(
    { kind: storageKind, config: {} },
    { ...pluginContext, resolveWorkspaceRoot },
  )

  // Semantic search is optional.
  // A deployment with no embedding backend keeps every other capability,
  // and simply cannot rank by meaning,
  // so nothing here may throw when the axis is left unset.
  // The address is the switch, since a backend cannot be reached without one.
  const embeddingHost = process.env.BRAID_EMBEDDING_HOST
  const embedder = embeddingHost
    ? new OpenAiCompatibleEmbedder({
      host: withoutTrailingSlash(embeddingHost),
      model: process.env.BRAID_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
      ...(process.env.BRAID_EMBEDDING_API_KEY
        ? { apiKey: process.env.BRAID_EMBEDDING_API_KEY }
        : {}),
      batchSize: EMBEDDING_BATCH_SIZE,
      timeoutMs: EMBEDDING_TIMEOUT_MS,
    })
    : undefined
  const embeddingRepository = new FsEmbeddingRepository({ resolveWorkspaceRoot })

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
  // The long-lived MCP endpoint a person points their own client at,
  // distinct from the per-run stdio gateway above.
  // Only a deployment that names an authorization server gets one,
  // since a shared static token would flatten every caller into one identity.
  const gatewayResolution = resolveMcpGateway(process.env, {
    apiUrl,
    loopbackApiUrl,
    audience: oidcAudience,
    uvxBin,
  })
  if (gatewayResolution.kind === 'incomplete') {
    console.warn(
      `[braid] The MCP endpoint cannot start without `
      + `${gatewayResolution.missing.join(', ')}. The REST API is unaffected.`,
    )
  }
  const mcpGateway = gatewayResolution.kind === 'ready' && uvxBin
    ? new McpGatewayProcess({
      uvxBin,
      configPath: join(braidHome, 'mcp-gateway.yaml'),
      config: gatewayResolution.config,
      gatewayPackage: gatewayResolution.gatewayPackage,
    })
    : undefined

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
    // The agent and the gateway both run on this host,
    // so they call back on loopback rather than through the public name.
    apiUrl: loopbackApiUrl,
    runRepository,
    eventBus,
    ...(uvxBin
      ? { coreGateway: { specUrl: `${loopbackApiUrl}/openapi.json`, uvxBin } }
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
    embeddingRepository,
    ...(embedder ? { embedder } : {}),
    unitLister: workspace => listUnitItems(workspace, unitBearingRolesOf(pluginRegistry, workspace)),
    ...(options.defaultOntologyId ? { defaultOntologyId: options.defaultOntologyId } : {}),
    // The reactor has no human caller, so it acts as the `reactor` service account,
    // minting a short-lived session so its API calls authenticate.
    reactorToken: async () => (await sessionStore.issue(REACTOR_USER_ID, { ttlSeconds: 3600 })).token,
    sourceUnitObservationRepository: new FsSourceUnitObservationRepository({ workspaceRoots }),
    sourceSyncStateRepository: new FsSourceSyncStateRepository({ workspaceRoots }),
    isWorkspaceBusy: workspaceId => skillRunner.hasActiveRun(workspaceId),
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
    ...(accessTokenVerifiers.length > 0 ? { accessTokenVerifiers } : {}),
    loginProviders,
    ...(mcpGateway ? { mcpGateway } : {}),
    mcpResolution: gatewayResolution,
    ...(gatewayResolution.kind === 'ready'
      ? { mcpGatewayUrl: `http://127.0.0.1:${gatewayResolution.config.port}` }
      : {}),
    ...(oidcIssuer ? { oidcIssuer, apiUrl } : {}),
    ...(studioRoot ? { studioRoot } : {}),
    ...(corsOrigins ? { corsOrigins } : {}),
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

/**
 * Refuse to trust every caller on a deployment reachable by other people.
 *
 * The default is local trust and suits a laptop,
 * but it is catastrophic on a shared host. Nothing else tells the two apart,
 * and naming a Studio origin that is not loopback is a deployment saying so out loud.
 */
function assertLocalTrustIsLocal(locallyTrusted: boolean, studioUrl: string): void {
  if (!locallyTrusted)
    return
  const host = hostOf(studioUrl)
  const isLoopback = host === undefined
    || host === 'localhost'
    || host === '127.0.0.1'
    || host === '[::1]'
    || host.endsWith('.localhost')
  if (isLoopback)
    return
  throw new Error(
    `BRAID_STUDIO_URL is "${studioUrl}", so this server is reachable by other people, `
    + 'but BRAID_LOCAL_TRUST is on and every caller would be trusted without signing in. '
    + 'Set BRAID_LOCAL_TRUST=false.',
  )
}

/** The hostname of a URL, without the port. */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase()
  }
  catch {
    return undefined
  }
}

/**
 * Which browser origins may call this API.
 *
 * A deployment that names its own Studio origin has left dev behind,
 * so the localhost defaults stop applying and only that origin,
 * plus anything named explicitly, gets through.
 * Leaving both unset keeps a local install on the dev defaults.
 */
function resolveCorsOrigins(studioUrl: string, extra: string | undefined): readonly string[] | undefined {
  const named = parseCsv(extra) ?? []
  const studioOrigin = originOf(studioUrl)
  const isDevDefault = studioOrigin === 'http://localhost:5173'
  if (isDevDefault && named.length === 0)
    return undefined
  return [...new Set([...(studioOrigin ? [studioOrigin] : []), ...named])]
}

/** The scheme and authority of a URL, the shape a browser sends as `Origin`. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  }
  catch {
    return undefined
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
