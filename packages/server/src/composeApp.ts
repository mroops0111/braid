import type {
  BatchPlanRepository,
  ClarificationRepository,
  Clock,
  IntentLister,
  ModelRepository,
  ModelSerializer,
  ProposalRepository,
  ReactorCycleRepository,
  RunRepository,
  SkillRegistry,
  SkillRunner,
  SourceUnitDigest,
  SourceUnitObservationRepository,
  UserDirectory,
  WorkspaceBootstrapService,
  WorkspaceEventBus,
  WorkspaceHistory,
  WorkspaceRepository,
} from '@braidhq/core'
import type { AbsolutePath } from '@braidhq/schema'
import type { AuthMode } from './authMode.js'
import type { AccessPolicy } from './infrastructure/auth/AccessPolicy.js'
import type { SessionStore } from './infrastructure/auth/SessionStore.js'
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
  SourceUnitObservationService,
  SystemClock,
  SystemScheduler,
  WorkspaceLock,
  WorkspaceService,
} from '@braidhq/core'
import {
  InMemoryClarificationRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemoryReactorCycleRepository,
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
  intentLister?: IntentLister
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
  batchPlanRepository?: BatchPlanRepository

  // Source-unit extraction.
  // Without a real digest the observation service falls back,
  // to a no-op stub that throws, fine unless a batch or reactor runs.
  intentLister?: IntentLister
  sourceUnitDigest?: SourceUnitDigest

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
}

export function composeApp(options: ComposeOptions = {}): AppDependencies {
  const clock = options.clock ?? new SystemClock()
  const proposalRepository = options.proposalRepository ?? new InMemoryProposalRepository()
  const clarificationRepository = options.clarificationRepository ?? new InMemoryClarificationRepository()
  const modelRepository = options.modelRepository ?? new InMemoryModelRepository()
  const workspaceRepository = options.workspaceRepository ?? new InMemoryWorkspaceRepository()
  const pluginRegistry = options.pluginRegistry ?? new PluginRegistry()

  const eventBus = options.eventBus ?? new InMemoryWorkspaceEventBus()
  const workspaceService = new WorkspaceService({ workspaceRepository, pluginRegistry })
  const modelService = new ModelService({ modelRepository })
  const modelValidationService = new ModelValidationService({ pluginRegistry })
  const sourceLoaderRunner = new SourceLoaderRunner({ pluginRegistry, clock, eventBus })
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
  const batchService = historyService && options.skillRunner && options.batchPlanRepository && options.intentLister
    ? new BatchService({
      workspaceService,
      skillRunner: options.skillRunner,
      proposalRepository,
      clarificationRepository,
      historyService,
      hitlService,
      batchPlanRepository: options.batchPlanRepository,
      intentLister: options.intentLister,
      pluginRegistry,
      eventBus,
      workspaceLock,
      clock,
      sourceUnitObservationService,
    })
    : undefined

  // Reactor shares Batch's dependency footprint of skillRunner, intentLister,
  // and sourceUnitObservationService, plus the event bus.
  // We construct it whenever those are present.
  // The service stays inert until something calls `start(workspaceId)`.
  // `composeFsApp` drives start on workspaces,
  // whose ProductManifest.reactor.enabled is true.
  const reactorCycleRepository: ReactorCycleRepository
    = options.reactorCycleRepository ?? new InMemoryReactorCycleRepository()
  const reactorService = options.skillRunner && options.intentLister && sourceUnitDigest && !(sourceUnitDigest instanceof FailingSourceUnitDigest)
    ? new ReactorService({
      eventBus,
      workspaceService,
      pluginRegistry,
      skillRunner: options.skillRunner,
      sourceUnitObservationService,
      intentLister: options.intentLister,
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
    ...(options.intentLister ? { intentLister: options.intentLister } : {}),
    ...(options.sourceUnitDigest ? { sourceUnitDigest: options.sourceUnitDigest } : {}),
    ...(options.bootstrap ? { bootstrap: options.bootstrap } : {}),
    sourceUnitObservationService,
    modelService,
    modelValidationService,
    sourceLoaderRunner,
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
