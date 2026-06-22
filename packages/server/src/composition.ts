import type {
  BatchPlanRepository,
  ClarifyTicketRepository,
  Clock,
  DecisionRepository,
  GraphSerializer,
  IntentLister,
  ModelRepository,
  ProposalRepository,
  RunRepository,
  SkillRegistry,
  SkillRunner,
  SourceUnitDigest,
  SourceUnitStateRepository,
  UserDirectory,
  WorkspaceBootstrap,
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
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BatchService,
  HistoryService,
  HITLService,
  ModelService,
  PerWorkspaceLock,
  PluginRegistry,
  ReactorService,
  SourceLoaderRunner,
  SourceUnitStateService,
  SystemClock,
  ValidationService,
  WorkspaceService,
} from '@braidhq/core'
import {
  InMemoryClarifyTicketRepository,
  InMemoryDecisionRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemorySourceUnitStateRepository,
  InMemoryWorkspaceEventBus,
  InMemoryWorkspaceRepository,
  noopRunRepository,
} from '@braidhq/core/testing'

export interface AppDependencies {
  workspaceService: WorkspaceService
  hitlService: HITLService
  historyService?: HistoryService
  batchService?: BatchService
  /**
   * Reactor that subscribes to `source.synced` and runs the active
   * ontology's per-unit skill on intent-source diffs (#29). Present
   * when the composition has skillRunner + intentLister + a real
   * SourceUnitDigest; absent in pure in-memory tests that don't
   * exercise it. `composeFsApp` is the production wiring path.
   */
  reactorService?: ReactorService
  sourceUnitStateService: SourceUnitStateService
  /**
   * Filesystem walk over a workspace's intent sources. Threaded into
   * the source-unit-states diff endpoint so the route can compose
   * `intentLister + digest + sourceUnitStateService` without
   * re-implementing the walk. Absent in pure in-memory tests.
   */
  intentLister?: IntentLister
  /**
   * Per-source-unit content digest. Same usage as `intentLister`;
   * absent in pure in-memory tests.
   */
  sourceUnitDigest?: SourceUnitDigest
  modelService: ModelService
  validationService: ValidationService
  sourceLoaderRunner: SourceLoaderRunner
  eventBus: WorkspaceEventBus
  pluginRegistry: PluginRegistry
  proposalRepository: ProposalRepository
  clarifyRepository: ClarifyTicketRepository
  decisionRepository: DecisionRepository
  modelRepository: ModelRepository
  workspaceRepository: WorkspaceRepository
  skillRegistry: SkillRegistry | undefined
  skillRunner: SkillRunner | undefined
  runRepository: RunRepository
  /**
   * Parent directory under which name-based workspaces are scaffolded.
   * `POST /workspaces/scaffold { name }` resolves to `<workspacesRoot>/<name>`.
   */
  workspacesRoot: AbsolutePath
  bootstrap?: WorkspaceBootstrap
  /** OAuth secret storage (file-based; pluggable for hosted deployments). */
  secretStore?: SecretStore
  /**
   * Google OAuth client. Undefined when env vars aren't set; routes
   *  respond with 503 in that case.
   */
  googleOAuth?: GoogleOAuth
  /**
   * Server-side user roster (Phase A scaffolding). When absent the
   * `/users` route is not mounted; routes that read `c.get('userId')`
   * still work because `userIdMiddleware` falls back to `local-user`.
   */
  userRegistry?: UserRegistryFile
  /**
   * Server-side workspace registry — backs the Phase C membership
   * model. Required to mount `workspaceAccessMiddleware` and the
   * `/workspaces/:id/members` routes; absent in pure in-memory tests
   * that don't need member-gating.
   */
  workspaceRegistry?: WorkspaceRegistryFile
  /**
   * Phase B: Bearer-token session backing. Required to mount `/auth/*`
   * and the auth middleware. Absent in tests that want the pre-Phase-A
   * trusted-network shape (no auth gate).
   */
  sessionStore?: SessionStore
  /**
   * Phase B: Gate-1 allowlist + invite list. Paired with `sessionStore`
   * to mount `/auth/*`.
   */
  accessPolicy?: AccessPolicy
  /**
   * Phase B: URL the Studio bundle is served from. OAuth callback
   * redirects here with `#token=...` so the SPA can capture the
   * session. Defaults to the Vite dev origin in `composeFsApp`.
   */
  studioUrl?: string
  /**
   * Phase B: when true (default in tests / local dev where Google
   * OAuth isn't configured), the auth middleware lets every request
   * through and `userIdMiddleware`'s fallback (`local-user`) takes
   * over. composeFs computes this from the presence of Google OAuth
   * env vars; production remote deployments end up with `false` and
   * an enforced Bearer-token gate.
   */
  localTrust: boolean
  clock: Clock
}

export interface ComposeOptions {
  clock?: Clock
  proposalRepository?: ProposalRepository
  clarifyRepository?: ClarifyTicketRepository
  decisionRepository?: DecisionRepository
  modelRepository?: ModelRepository
  workspaceRepository?: WorkspaceRepository
  pluginRegistry?: PluginRegistry
  skillRegistry?: SkillRegistry
  skillRunner?: SkillRunner
  runRepository?: RunRepository
  /**
   * Parent dir for name-based scaffold. composeFsApp sets this to
   * `<braidHome>/workspaces`; tests using composeApp directly can leave
   * it at the default unless they exercise the scaffold endpoint.
   */
  workspacesRoot?: AbsolutePath
  /**
   * Pre-created event bus. Pass the same instance you wired into
   * `SubprocessSkillRunner` so subscribers see runner events. Defaults
   * to a fresh `InMemoryWorkspaceEventBus` for tests / in-memory boot.
   */
  eventBus?: WorkspaceEventBus
  // Both required together; HITLService skips git hooks when absent.
  history?: WorkspaceHistory
  graphSerializer?: GraphSerializer
  bootstrap?: WorkspaceBootstrap
  batchPlanRepository?: BatchPlanRepository
  intentLister?: IntentLister
  /**
   * Persistence for `SourceUnitState`. Defaults to an in-memory impl
   * so unit tests of unrelated services keep working without wiring;
   * `composeFsApp` swaps in the fs-backed repo.
   */
  sourceUnitStateRepository?: SourceUnitStateRepository
  /**
   * Content fingerprinter for source units. Required for batch / reactor
   * / manual extract to record observations. Without it the
   * `SourceUnitStateService` falls back to a no-op stub digest that
   * throws on use, which is fine for tests that don't exercise observation
   * recording but would break production batches.
   */
  sourceUnitDigest?: SourceUnitDigest
  /**
   * Optional read-only user lookup used by HITLService / HistoryService
   * to snapshot displayName + email into the git author when committing.
   * Tests skip this so the existing `Author: <userId>` shape is preserved.
   */
  userDirectory?: UserDirectory
}

export function composeApp(options: ComposeOptions = {}): AppDependencies {
  const clock = options.clock ?? new SystemClock()
  const proposalRepository = options.proposalRepository ?? new InMemoryProposalRepository()
  const clarifyRepository = options.clarifyRepository ?? new InMemoryClarifyTicketRepository()
  const decisionRepository = options.decisionRepository ?? new InMemoryDecisionRepository()
  const modelRepository = options.modelRepository ?? new InMemoryModelRepository()
  const workspaceRepository = options.workspaceRepository ?? new InMemoryWorkspaceRepository()
  const pluginRegistry = options.pluginRegistry ?? new PluginRegistry()

  const eventBus = options.eventBus ?? new InMemoryWorkspaceEventBus()
  const workspaceService = new WorkspaceService({ workspaceRepository })
  const modelService = new ModelService({ modelRepository })
  const validationService = new ValidationService({ pluginRegistry })
  const sourceLoaderRunner = new SourceLoaderRunner({ pluginRegistry, clock, eventBus })
  // Shared lock domain so HITL mutations and history restore exclude each other.
  const workspaceLock = new PerWorkspaceLock()
  const hitlService = new HITLService({
    proposalRepository,
    clarifyRepository,
    decisionRepository,
    modelRepository,
    validationService,
    workspaceService,
    clock,
    eventBus,
    workspaceLock,
    ...(options.history ? { history: options.history } : {}),
    ...(options.graphSerializer ? { graphSerializer: options.graphSerializer } : {}),
    ...(options.userDirectory ? { userDirectory: options.userDirectory } : {}),
  })

  const historyService = options.history && options.bootstrap
    ? new HistoryService({
      history: options.history,
      workspaceService,
      workspaceLock,
      bootstrap: options.bootstrap,
      runRepository: options.runRepository ?? noopRunRepository,
      ...(options.skillRunner ? { skillRunner: options.skillRunner } : {}),
      ...(options.userDirectory ? { userDirectory: options.userDirectory } : {}),
      eventBus,
      clock,
    })
    : undefined

  const sourceUnitStateRepository = options.sourceUnitStateRepository ?? new InMemorySourceUnitStateRepository()
  const sourceUnitDigest = options.sourceUnitDigest ?? new FailingSourceUnitDigest()
  const sourceUnitStateService = new SourceUnitStateService({
    repository: sourceUnitStateRepository,
    digest: sourceUnitDigest,
    workspaceService,
    clock,
  })

  // Batch needs SkillRunner + HistoryService + BatchPlanRepository + intent lister; otherwise no batch surface.
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
      sourceUnitStateService,
    })
    : undefined

  // Reactor shares Batch's dependency footprint (skillRunner +
  // intentLister + sourceUnitStateService) plus the event bus. We
  // construct it whenever those are present; the service stays inert
  // until something calls `start(workspaceId)`. composeFsApp drives
  // start on workspaces whose ProductManifest.reactor.enabled is true.
  const reactorService = options.skillRunner && options.intentLister && sourceUnitDigest && !(sourceUnitDigest instanceof FailingSourceUnitDigest)
    ? new ReactorService({
      eventBus,
      workspaceService,
      pluginRegistry,
      skillRunner: options.skillRunner,
      sourceUnitStateService,
      intentLister: options.intentLister,
      digest: sourceUnitDigest,
      clock,
    })
    : undefined

  return {
    workspaceService,
    hitlService,
    ...(historyService ? { historyService } : {}),
    ...(batchService ? { batchService } : {}),
    ...(reactorService ? { reactorService } : {}),
    ...(options.intentLister ? { intentLister: options.intentLister } : {}),
    ...(options.sourceUnitDigest ? { sourceUnitDigest: options.sourceUnitDigest } : {}),
    ...(options.bootstrap ? { bootstrap: options.bootstrap } : {}),
    sourceUnitStateService,
    modelService,
    validationService,
    sourceLoaderRunner,
    eventBus,
    pluginRegistry,
    proposalRepository,
    clarifyRepository,
    decisionRepository,
    modelRepository,
    workspaceRepository,
    skillRegistry: options.skillRegistry,
    skillRunner: options.skillRunner,
    runRepository: options.runRepository ?? noopRunRepository,
    workspacesRoot: options.workspacesRoot ?? (join(tmpdir(), 'braid-workspaces') as AbsolutePath),
    // `composeApp` is the test / in-memory composition entry. It never
    // wires sessionStore, so the auth middleware in `createApp` is
    // skipped anyway — but explicit `localTrust: true` keeps the
    // contract honest if a test does happen to pass sessionStore.
    localTrust: true,
    clock,
  }
}

/**
 * Default `SourceUnitDigest` for in-memory `composeApp()` callers. Any
 * call throws — production must wire a real impl via `composeFsApp` or
 * pass one explicitly; tests that don't exercise observations stay
 * happy because the digest is never reached.
 */
class FailingSourceUnitDigest implements SourceUnitDigest {
  async computeSha(): Promise<never> {
    throw new Error(
      'SourceUnitDigest is not wired. Pass `sourceUnitDigest` to composeApp() (composeFsApp does this automatically).',
    )
  }
}
