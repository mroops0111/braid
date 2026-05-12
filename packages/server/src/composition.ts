import type {
  ClarifyTicketRepository,
  Clock,
  DecisionRepository,
  ModelRepository,
  ProposalRepository,
  SkillRegistry,
  SkillRunner,
  WorkspaceRepository,
} from '@telos/core'
import {
  HITLService,
  InMemoryClarifyTicketRepository,
  InMemoryDecisionRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemoryWorkspaceRepository,
  ModelService,
  PluginRegistry,
  SystemClock,
  ValidationService,
  WorkspaceService,
} from '@telos/core'

export interface AppDependencies {
  workspaceService: WorkspaceService
  hitlService: HITLService
  modelService: ModelService
  validationService: ValidationService
  pluginRegistry: PluginRegistry
  proposalRepository: ProposalRepository
  clarifyRepository: ClarifyTicketRepository
  decisionRepository: DecisionRepository
  modelRepository: ModelRepository
  workspaceRepository: WorkspaceRepository
  skillRegistry: SkillRegistry | undefined
  skillRunner: SkillRunner | undefined
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
    pluginRegistry,
    proposalRepository,
    clarifyRepository,
    decisionRepository,
    modelRepository,
    workspaceRepository,
    skillRegistry: options.skillRegistry,
    skillRunner: options.skillRunner,
    clock,
  }
}
