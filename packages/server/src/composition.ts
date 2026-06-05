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
  UserDirectory,
  WorkspaceBootstrap,
  WorkspaceEventBus,
  WorkspaceHistory,
  WorkspaceRepository,
} from '@braidhq/core'
import type { AbsolutePath } from '@braidhq/schema'
import type { AccessPolicy } from './infrastructure/auth/AccessPolicy.js'
import type { SessionStore } from './infrastructure/auth/SessionStore.js'
import type { GoogleOAuth } from './infrastructure/oauth/GoogleOAuth.js'
import type { SecretStore } from './infrastructure/secrets/SecretStore.js'
import type { UserRegistryFile } from './infrastructure/users/UserRegistryFile.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BatchService,
  HistoryService,
  HITLService,
  InMemoryClarifyTicketRepository,
  InMemoryDecisionRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemoryWorkspaceEventBus,
  InMemoryWorkspaceRepository,
  ModelService,
  noopRunRepository,
  PerWorkspaceLock,
  PluginRegistry,
  SourceLoaderRunner,
  SystemClock,
  ValidationService,
  WorkspaceService,
} from '@braidhq/core'

export interface AppDependencies {
  workspaceService: WorkspaceService
  hitlService: HITLService
  historyService?: HistoryService
  batchService?: BatchService
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
      eventBus,
      workspaceLock,
      clock,
    })
    : undefined

  return {
    workspaceService,
    hitlService,
    ...(historyService ? { historyService } : {}),
    ...(batchService ? { batchService } : {}),
    ...(options.bootstrap ? { bootstrap: options.bootstrap } : {}),
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
