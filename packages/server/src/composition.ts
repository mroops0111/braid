import type {
  ClarifyTicketRepository,
  Clock,
  DecisionRepository,
  ModelRepository,
  ProposalRepository,
  RunRepository,
  SkillRegistry,
  SkillRunner,
  WorkspaceRepository,
} from '@telos/core'
import type { GoogleOAuth } from './infrastructure/oauth/GoogleOAuth.js'
import type { SecretStore } from './infrastructure/secrets/SecretStore.js'
import {
  HITLService,
  InMemoryClarifyTicketRepository,
  InMemoryDecisionRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemoryWorkspaceRepository,
  ModelService,
  noopRunRepository,
  PluginRegistry,
  SourceLoaderRunner,
  SystemClock,
  ValidationService,
  WorkspaceService,
} from '@telos/core'

export interface AppDependencies {
  workspaceService: WorkspaceService
  hitlService: HITLService
  modelService: ModelService
  validationService: ValidationService
  sourceLoaderRunner: SourceLoaderRunner
  pluginRegistry: PluginRegistry
  proposalRepository: ProposalRepository
  clarifyRepository: ClarifyTicketRepository
  decisionRepository: DecisionRepository
  modelRepository: ModelRepository
  workspaceRepository: WorkspaceRepository
  skillRegistry: SkillRegistry | undefined
  skillRunner: SkillRunner | undefined
  runRepository: RunRepository
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
}

export function composeApp(options: ComposeOptions = {}): AppDependencies {
  const clock = options.clock ?? new SystemClock()
  const proposalRepository = options.proposalRepository ?? new InMemoryProposalRepository()
  const clarifyRepository = options.clarifyRepository ?? new InMemoryClarifyTicketRepository()
  const decisionRepository = options.decisionRepository ?? new InMemoryDecisionRepository()
  const modelRepository = options.modelRepository ?? new InMemoryModelRepository()
  const workspaceRepository = options.workspaceRepository ?? new InMemoryWorkspaceRepository()
  const pluginRegistry = options.pluginRegistry ?? new PluginRegistry()

  const workspaceService = new WorkspaceService({ workspaceRepository })
  const modelService = new ModelService({ modelRepository })
  const validationService = new ValidationService({ pluginRegistry })
  const sourceLoaderRunner = new SourceLoaderRunner({ pluginRegistry, clock })
  const hitlService = new HITLService({
    proposalRepository,
    clarifyRepository,
    decisionRepository,
    modelRepository,
    validationService,
    clock,
  })

  return {
    workspaceService,
    hitlService,
    modelService,
    validationService,
    sourceLoaderRunner,
    pluginRegistry,
    proposalRepository,
    clarifyRepository,
    decisionRepository,
    modelRepository,
    workspaceRepository,
    skillRegistry: options.skillRegistry,
    skillRunner: options.skillRunner,
    runRepository: options.runRepository ?? noopRunRepository,
    clock,
  }
}
