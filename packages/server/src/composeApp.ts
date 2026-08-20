import type {
  BatchPlanRepository,
  ClarificationRepository,
  Clock,
  ModelRepository,
  ModelSerializer,
  ProposalRepository,
  ReactorCycleRepository,
  RunRepository,
  SkillRegistry,
  SkillRunner,
  SourceSyncStateRepository,
  SourceUnitDigest,
  SourceUnitObservationRepository,
  UnitLister,
  UserDirectory,
  WorkspaceBootstrapService,
  WorkspaceEventBus,
  WorkspaceHistory,
  WorkspaceRepository,
} from '@braidhq/core'
import type { AbsolutePath, OntologyId, WorkspaceId } from '@braidhq/schema'
import type { AuthMode } from './authMode.js'
import type { AccessPolicy } from './infrastructure/auth/AccessPolicy.js'
import type { SessionStore } from './infrastructure/auth/SessionStore.js'
import type { GitHubOAuth } from './infrastructure/oauth/GitHubOAuth.js'
import type { GoogleOAuth } from './infrastructure/oauth/GoogleOAuth.js'
import type { SecretStore } from './infrastructure/secrets/SecretStore.js'
import type { UserRegistryFile } from './infrastructure/users/UserRegistryFile.js'
import type { WorkspaceRegistryFile } from './infrastructure/workspace/WorkspaceRegistryFile.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BatchService,
  createLogger,
  HistoryService,
  HITLService,
  ModelService,
  ModelValidationService,
  PluginRegistry,
  ReactorService,
  SourceLoaderRunner,
  SourcePollingService,
  SourceSyncService,
  SourceUnitObservationService,
  SystemClock,
  SystemScheduler,
  TaskCoalescer,
  WorkspaceLock,
  WorkspaceService,
} from '@braidhq/core'
import {
  InMemoryClarificationRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemoryReactorCycleRepository,
  InMemorySourceSyncStateRepository,
  InMemorySourceUnitObservationRepository,
  InMemoryWorkspaceEventBus,
  InMemoryWorkspaceRepository,
  NoopRunRepository,
} from '@braidhq/core/in-memory'
import { localTrust } from './authMode.js'

/**
 * The assembled application, what routes and middleware consume.
 * A required field is always present.
 * An optional field is a capability slot,
 * absent under in-memory or test wiring, filled by `composeFsApp`.
 */
export interface AppDependencies {
  // Core services, always present.
  workspaceService: WorkspaceService
  hitlService: HITLService
  modelService: ModelService
  modelValidationService: ModelValidationService
  sourceLoaderRunner: SourceLoaderRunner
  // The entry point every sync trigger uses.
  // Calling the runner directly skips the lock,
  // and leaves the sync-state store untouched.
  sourceSyncService: SourceSyncService
  sourcePollingService: SourcePollingService
  syncStateRepository: SourceSyncStateRepository
  isWorkspaceBusy?: (workspaceId: WorkspaceId) => boolean
  sourceUnitObservationService: SourceUnitObservationService

  // Capability services, each built only when its dependencies are wired.
  historyService?: HistoryService
  batchService?: BatchService
  // Runs the active ontology's per-unit skill on intent-source diffs.
  reactorService?: ReactorService

  // Repositories, in-memory by default, fs-backed via `composeFsApp`.
  modelRepository: ModelRepository
  workspaceRepository: WorkspaceRepository
  proposalRepository: ProposalRepository
  clarificationRepository: ClarificationRepository
  runRepository: RunRepository
  // Always wired, the Activity page renders an empty list before any cycle.
  reactorCycleRepository: ReactorCycleRepository

  // Source-unit extraction, the filesystem walk and content digest,
  // threaded into the source-unit-states diff endpoint.
  unitLister?: UnitLister
  sourceUnitDigest?: SourceUnitDigest

  // Skills, the registry and the subprocess runner.
  skillRegistry: SkillRegistry | undefined
  skillRunner: SkillRunner | undefined

  // Infrastructure singletons.
  eventBus: WorkspaceEventBus
  pluginRegistry: PluginRegistry
  clock: Clock

  // Workspace scaffolding.
  // `POST /workspaces/scaffold { name }` resolves to `<workspacesRoot>/<name>`.
  workspacesRoot: AbsolutePath
  // What a scaffold writes when its manifest names no ontology.
  // Absent when the registry holds no ontology or more than one,
  // then the manifest schema's own default applies.
  defaultOntologyId?: OntologyId
  bootstrap?: WorkspaceBootstrapService

  // Identity and auth, the multi-user axis.
  // Local trust carries a default principal,
  // so unauthenticated requests pass through as that user.
  // Authenticated mode carries none, so a Bearer token is enforced.
  authMode: AuthMode
  // Each absent field drops its surface,
  // no `userRegistry` unmounts `/users`,
  // no `sessionStore` with `accessPolicy` unmounts `/auth/*`,
  // no `workspaceRegistry` unmounts member-gating and the members routes.
  userRegistry?: UserRegistryFile
  workspaceRegistry?: WorkspaceRegistryFile
  sessionStore?: SessionStore
  accessPolicy?: AccessPolicy
  // OAuth secret storage, file-based, pluggable for hosted deployments.
  secretStore?: SecretStore
  // Google client, undefined when its env is unset,
  // then `/auth/google/*` respond 503.
  googleOAuth?: GoogleOAuth
  // GitHub App client, undefined when its env is unset,
  // then `/oauth/github/*` respond 503.
  githubOAuth?: GitHubOAuth
  // Where the OAuth callback redirects with `#token=...`,
  // defaults to the Vite dev origin.
  studioUrl?: string
}

/**
 * Every field is optional, an unset one falls to an in-memory default.
 * `composeFsApp` passes the fs, git, and vendor adapters through here.
 */
export interface ComposeOptions {
  // Infrastructure singletons.
  clock?: Clock
  // The same instance wired into `SubprocessSkillRunner`,
  // so event-bus subscribers see runner events.
  eventBus?: WorkspaceEventBus
  pluginRegistry?: PluginRegistry

  // Repositories.
  modelRepository?: ModelRepository
  workspaceRepository?: WorkspaceRepository
  proposalRepository?: ProposalRepository
  clarificationRepository?: ClarificationRepository
  runRepository?: RunRepository
  // Swapped fs-backed by `composeFsApp`, so records survive restart.
  reactorCycleRepository?: ReactorCycleRepository
  sourceUnitObservationRepository?: SourceUnitObservationRepository
  sourceSyncStateRepository?: SourceSyncStateRepository
  batchPlanRepository?: BatchPlanRepository
  // Whether a skill run currently holds a workspace's sources.
  isWorkspaceBusy?: (workspaceId: WorkspaceId) => boolean

  // Source-unit extraction.
  // Without a real digest the observation service falls back,
  // to a no-op stub that throws, fine unless a batch or reactor runs.
  unitLister?: UnitLister
  sourceUnitDigest?: SourceUnitDigest
  // Yields the caller token the reactor's autonomous runs act under.
  // Absent means the reactor runs tokenless, falling back to the default principal.
  reactorToken?: () => Promise<string | undefined>

  // Skills.
  skillRegistry?: SkillRegistry
  skillRunner?: SkillRunner

  // History and git authorship, both required together,
  // HITL skips git hooks when absent.
  history?: WorkspaceHistory
  modelSerializer?: ModelSerializer
  bootstrap?: WorkspaceBootstrapService
  // Read-only user lookup, snapshots displayName and email into the git author.
  userDirectory?: UserDirectory

  // Identity and scaffolding.
  authMode?: AuthMode
  // Scaffold parent, `<braidHome>/workspaces` in `composeFsApp`.
  workspacesRoot?: AbsolutePath
  // Overrides the sole-registered-ontology derivation below.
  // A build registering several ontologies names its scaffold default here.
  defaultOntologyId?: OntologyId
}

export function composeApp(options: ComposeOptions = {}): AppDependencies {
  const clock = options.clock ?? new SystemClock()
  const proposalRepository = options.proposalRepository ?? new InMemoryProposalRepository()
  const clarificationRepository = options.clarificationRepository ?? new InMemoryClarificationRepository()
  const modelRepository = options.modelRepository ?? new InMemoryModelRepository()
  const workspaceRepository = options.workspaceRepository ?? new InMemoryWorkspaceRepository()
  const pluginRegistry = options.pluginRegistry ?? new PluginRegistry()
  // A build registering exactly one ontology has no ambiguity to resolve,
  // so a scaffold that names none gets that one rather than a hardwired id.
  const ontologies = pluginRegistry.ontologies()
  const defaultOntologyId = options.defaultOntologyId
    ?? (ontologies.length === 1 ? ontologies[0]?.ontologyId : undefined)

  const eventBus = options.eventBus ?? new InMemoryWorkspaceEventBus()
  const workspaceService = new WorkspaceService({ workspaceRepository, pluginRegistry })
  const modelService = new ModelService({ modelRepository })
  const modelValidationService = new ModelValidationService({ pluginRegistry })
  const sourceLoaderRunner = new SourceLoaderRunner({ pluginRegistry, clock, eventBus })
  const syncStateRepository = options.sourceSyncStateRepository ?? new InMemorySourceSyncStateRepository()
  const sourceSyncService = new SourceSyncService({
    sourceLoaderRunner,
    syncStateRepository,
    coalescer: new TaskCoalescer(),
    clock,
    logger: createLogger('source-sync'),
  })
  const sourcePollingService = new SourcePollingService({
    sourceSyncService,
    workspaceService,
    scheduler: new SystemScheduler(),
    clock,
    logger: createLogger('source-polling'),
    ...(options.isWorkspaceBusy ? { isWorkspaceBusy: options.isWorkspaceBusy } : {}),
  })
  // Shared lock domain so HITL mutations and history restore exclude each other.
  const workspaceLock = new WorkspaceLock()
  const hitlService = new HITLService({
    proposalRepository,
    clarificationRepository,
    modelRepository,
    modelValidationService,
    workspaceService,
    clock,
    eventBus,
    workspaceLock,
    ...(options.history ? { history: options.history } : {}),
    ...(options.modelSerializer ? { modelSerializer: options.modelSerializer } : {}),
    ...(options.userDirectory ? { userDirectory: options.userDirectory } : {}),
  })

  const historyService = options.history && options.bootstrap
    ? new HistoryService({
      history: options.history,
      workspaceService,
      workspaceLock,
      bootstrap: options.bootstrap,
      runRepository: options.runRepository ?? new NoopRunRepository(),
      ...(options.skillRunner ? { skillRunner: options.skillRunner } : {}),
      ...(options.userDirectory ? { userDirectory: options.userDirectory } : {}),
      eventBus,
      clock,
    })
    : undefined

  const sourceUnitObservationRepository = options.sourceUnitObservationRepository ?? new InMemorySourceUnitObservationRepository()
  const sourceUnitDigest = options.sourceUnitDigest ?? new FailingSourceUnitDigest()
  const sourceUnitObservationService = new SourceUnitObservationService({
    repository: sourceUnitObservationRepository,
    digest: sourceUnitDigest,
    workspaceService,
    clock,
  })

  // Batch needs SkillRunner, HistoryService, BatchPlanRepository, and a lister.
  // Without them there is no batch surface.
  const batchService = historyService && options.skillRunner && options.batchPlanRepository && options.unitLister
    ? new BatchService({
      workspaceService,
      skillRunner: options.skillRunner,
      proposalRepository,
      clarificationRepository,
      historyService,
      hitlService,
      batchPlanRepository: options.batchPlanRepository,
      unitLister: options.unitLister,
      pluginRegistry,
      eventBus,
      workspaceLock,
      clock,
      sourceUnitObservationService,
    })
    : undefined

  // Reactor shares Batch's dependency footprint of skillRunner, unitLister,
  // and sourceUnitObservationService, plus the event bus.
  // We construct it whenever those are present.
  // The service stays inert until something calls `start(workspaceId)`.
  // `composeFsApp` drives start on workspaces,
  // whose ProductManifest.reactor.enabled is true.
  const reactorCycleRepository: ReactorCycleRepository
    = options.reactorCycleRepository ?? new InMemoryReactorCycleRepository()
  const reactorService = options.skillRunner && options.unitLister && sourceUnitDigest && !(sourceUnitDigest instanceof FailingSourceUnitDigest)
    ? new ReactorService({
      eventBus,
      workspaceService,
      pluginRegistry,
      skillRunner: options.skillRunner,
      sourceUnitObservationService,
      unitLister: options.unitLister,
      ...(options.reactorToken ? { reactorToken: options.reactorToken } : {}),
      digest: sourceUnitDigest,
      reactorCycleRepository,
      workspaceLock,
      clock,
      logger: createLogger('reactor'),
      scheduler: new SystemScheduler(),
    })
    : undefined

  return {
    workspaceService,
    hitlService,
    ...(historyService ? { historyService } : {}),
    ...(batchService ? { batchService } : {}),
    ...(reactorService ? { reactorService } : {}),
    reactorCycleRepository,
    ...(options.unitLister ? { unitLister: options.unitLister } : {}),
    ...(options.sourceUnitDigest ? { sourceUnitDigest: options.sourceUnitDigest } : {}),
    ...(options.bootstrap ? { bootstrap: options.bootstrap } : {}),
    sourceUnitObservationService,
    modelService,
    modelValidationService,
    sourceLoaderRunner,
    sourceSyncService,
    sourcePollingService,
    syncStateRepository,
    ...(options.isWorkspaceBusy ? { isWorkspaceBusy: options.isWorkspaceBusy } : {}),
    eventBus,
    pluginRegistry,
    proposalRepository,
    clarificationRepository,
    modelRepository,
    workspaceRepository,
    skillRegistry: options.skillRegistry,
    skillRunner: options.skillRunner,
    runRepository: options.runRepository ?? new NoopRunRepository(),
    workspacesRoot: options.workspacesRoot ?? (join(tmpdir(), 'braid-workspaces') as AbsolutePath),
    ...(defaultOntologyId ? { defaultOntologyId } : {}),
    // `composeApp` is the test and in-memory composition entry.
    // It defaults to local trust, the local-user fallback,
    // so a test that wires a sessionStore still resolves a caller.
    authMode: options.authMode ?? localTrust,
    clock,
  }
}

// Default `SourceUnitDigest` for in-memory `composeApp()` callers. Any call throws.
// Production must wire a real impl via `composeFsApp` or pass one explicitly.
// Tests that don't exercise observations stay happy,
// because the digest is never reached.
class FailingSourceUnitDigest implements SourceUnitDigest {
  async computeSha(): Promise<never> {
    throw new Error(
      'SourceUnitDigest is not wired. Pass `sourceUnitDigest` to composeApp() (composeFsApp does this automatically).',
    )
  }
}
