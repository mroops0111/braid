import type {
  BatchPlanRepository,
  ClarifyTicketRepository,
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
import type { AccessPolicy } from './infrastructure/auth/AccessPolicy.js'
import type { SessionStore } from './infrastructure/auth/SessionStore.js'
import type { WorkspaceRegistryFile } from './infrastructure/fs/WorkspaceRegistryFile.js'
import type { GoogleOAuth } from './infrastructure/oauth/GoogleOAuth.js'
import type { SecretStore } from './infrastructure/secrets/SecretStore.js'
import type { UserRegistryFile } from './infrastructure/users/UserRegistryFile.js'
import type { TenancyMode } from './tenancy.js'
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
  InMemoryClarifyTicketRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemoryReactorCycleRepository,
  InMemorySourceUnitObservationRepository,
  InMemoryWorkspaceEventBus,
  InMemoryWorkspaceRepository,
  NoopRunRepository,
} from '@braidhq/core/in-memory'
import { singleTenant } from './tenancy.js'

export interface AppDependencies {
  workspaceService: WorkspaceService
  hitlService: HITLService
  historyService?: HistoryService
  batchService?: BatchService
  // Subscribes to `source.synced`,
  // runs the active ontology's per-unit skill on intent-source diffs.
  // Present when the composition has skillRunner, intentLister,
  // and a real SourceUnitDigest.
  // Absent in pure in-memory tests that don't exercise it.
  // `composeFsApp` is the wiring path.
  reactorService?: ReactorService
  // Persistence of `ReactorCycle` records. Always wired, in-memory by default,
  // fs-backed via `composeFsApp`,
  // so the REST and Studio surfaces render an empty list before any cycle runs.
  reactorCycleRepository: ReactorCycleRepository
  sourceUnitObservationService: SourceUnitObservationService
  // Filesystem walk over a workspace's intent sources,
  // threaded into the source-unit-states diff endpoint,
  // so the route composes intentLister, digest, and sourceUnitObservationService,
  // without re-implementing the walk.
  // Absent in pure in-memory tests.
  intentLister?: IntentLister
  // Per-source-unit content digest. Same usage as `intentLister`.
  // Absent in pure in-memory tests.
  sourceUnitDigest?: SourceUnitDigest
  modelService: ModelService
  modelValidationService: ModelValidationService
  sourceLoaderRunner: SourceLoaderRunner
  eventBus: WorkspaceEventBus
  pluginRegistry: PluginRegistry
  proposalRepository: ProposalRepository
  clarifyRepository: ClarifyTicketRepository
  modelRepository: ModelRepository
  workspaceRepository: WorkspaceRepository
  skillRegistry: SkillRegistry | undefined
  skillRunner: SkillRunner | undefined
  runRepository: RunRepository
  // Parent directory under which name-based workspaces are scaffolded.
  // `POST /workspaces/scaffold { name }` resolves to `<workspacesRoot>/<name>`.
  workspacesRoot: AbsolutePath
  bootstrap?: WorkspaceBootstrapService
  // OAuth secret storage, file-based, pluggable for hosted deployments.
  secretStore?: SecretStore
  // Google OAuth client. Undefined when env vars aren't set,
  // in which case routes respond with 503.
  googleOAuth?: GoogleOAuth
  // Server-side user roster. When absent the `/users` route is not mounted.
  // Routes that read `c.get('userId')` still work,
  // because `userIdMiddleware` falls back to the tenancy's default principal.
  userRegistry?: UserRegistryFile
  // Server-side workspace registry backing the membership model.
  // Required to mount `workspaceAccessMiddleware`,
  // and the `/workspaces/:id/members` routes.
  // Absent in pure in-memory tests that don't need member-gating.
  workspaceRegistry?: WorkspaceRegistryFile
  // Bearer-token session backing. Required to mount `/auth/*` and the middleware.
  // Absent in tests that want the trusted-network shape with no auth gate.
  sessionStore?: SessionStore
  // Allowlist plus invite list. Paired with `sessionStore` to mount `/auth/*`.
  accessPolicy?: AccessPolicy
  // URL the Studio bundle is served from. The OAuth callback redirects here,
  // with `#token=...`, so the SPA can capture the session.
  // Defaults to the Vite dev origin in `composeFsApp`.
  studioUrl?: string
  // The deployment's identity strategy, single-tenant or multi-tenant.
  // Single-tenant carries a default principal,
  // so the auth middleware lets unauthenticated requests through as that user.
  // Multi-tenant carries none, so a Bearer token is enforced.
  tenancy: TenancyMode
  clock: Clock
}

export interface ComposeOptions {
  clock?: Clock
  // Identity strategy for the deployment. Defaults to single-tenant.
  tenancy?: TenancyMode
  proposalRepository?: ProposalRepository
  clarifyRepository?: ClarifyTicketRepository
  modelRepository?: ModelRepository
  workspaceRepository?: WorkspaceRepository
  pluginRegistry?: PluginRegistry
  skillRegistry?: SkillRegistry
  skillRunner?: SkillRunner
  runRepository?: RunRepository
  // Parent dir for scaffolds, set to `<braidHome>/workspaces` by `composeFsApp`.
  // Tests using `composeApp` directly can leave the default,
  // unless they exercise the scaffold endpoint.
  workspacesRoot?: AbsolutePath
  // Pre-created event bus, the same instance wired into `SubprocessSkillRunner`,
  // so subscribers see runner events.
  // Defaults to a fresh `InMemoryWorkspaceEventBus` for tests and in-memory boot.
  eventBus?: WorkspaceEventBus
  // Both required together. HITLService skips git hooks when absent.
  history?: WorkspaceHistory
  modelSerializer?: ModelSerializer
  bootstrap?: WorkspaceBootstrapService
  batchPlanRepository?: BatchPlanRepository
  intentLister?: IntentLister
  // Persistence for `SourceUnitObservation`. Defaults to an in-memory impl,
  // so unit tests of unrelated services keep working without wiring.
  // `composeFsApp` swaps in the fs-backed repo.
  sourceUnitObservationRepository?: SourceUnitObservationRepository
  // Persistence for `ReactorCycle`. Defaults to an in-memory impl,
  // so unit tests of unrelated services keep working without wiring.
  // `composeFsApp` swaps in the fs-backed repo,
  // so cycles survive restart and the Studio Activity page can render history.
  reactorCycleRepository?: ReactorCycleRepository
  // Content fingerprinter for source units.
  // Required for batch, reactor, and manual extract to record observations.
  // Without it the `SourceUnitObservationService` falls back,
  // to a no-op stub digest that throws on use.
  // Fine for tests that don't record observations, but would break batches.
  sourceUnitDigest?: SourceUnitDigest
  // Optional read-only user lookup used by HITLService and HistoryService,
  // to snapshot displayName and email into the git author when committing.
  // Tests skip this so the existing `Author: <userId>` shape is preserved.
  userDirectory?: UserDirectory
}

export function composeApp(options: ComposeOptions = {}): AppDependencies {
  const clock = options.clock ?? new SystemClock()
  const proposalRepository = options.proposalRepository ?? new InMemoryProposalRepository()
  const clarifyRepository = options.clarifyRepository ?? new InMemoryClarifyTicketRepository()
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
    clarifyRepository,
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
      clarifyRepository,
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
    clarifyRepository,
    modelRepository,
    workspaceRepository,
    skillRegistry: options.skillRegistry,
    skillRunner: options.skillRunner,
    runRepository: options.runRepository ?? new NoopRunRepository(),
    workspacesRoot: options.workspacesRoot ?? (join(tmpdir(), 'braid-workspaces') as AbsolutePath),
    // `composeApp` is the test and in-memory composition entry.
    // It defaults to single-tenant, the local-user fallback,
    // so a test that wires a sessionStore still resolves a caller.
    tenancy: options.tenancy ?? singleTenant,
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
