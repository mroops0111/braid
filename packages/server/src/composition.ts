import type {
  ClarifyTicketRepository,
  Clock,
  DecisionRepository,
  GraphSerializer,
  ModelRepository,
  ProposalRepository,
  RunRepository,
  SkillRegistry,
  SkillRunner,
  WorkspaceBootstrap,
  WorkspaceEventBus,
  WorkspaceHistory,
  WorkspaceRepository,
} from '@braidhq/core'
import type { AbsolutePath } from '@braidhq/schema'
import type { GoogleOAuth } from './infrastructure/oauth/GoogleOAuth.js'
import type { SecretStore } from './infrastructure/secrets/SecretStore.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
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
  })

  const historyService = options.history && options.bootstrap
    ? new HistoryService({
      history: options.history,
      workspaceService,
      workspaceLock,
      bootstrap: options.bootstrap,
      runRepository: options.runRepository ?? noopRunRepository,
      ...(options.skillRunner ? { skillRunner: options.skillRunner } : {}),
      eventBus,
      clock,
    })
    : undefined

  return {
    workspaceService,
    hitlService,
    ...(historyService ? { historyService } : {}),
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
    clock,
  }
}
