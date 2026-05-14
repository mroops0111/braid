import type { AbsolutePath, AgentEffort, AgentId, AgentKind, WorkspaceId } from '@telos/schema'
import type { AppDependencies } from './composition.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  builtinSkillsRoot,
  EvidenceValidator,
  NotFoundError,
  OrphanEdgeValidator,
  PluginRegistry,
} from '@telos/core'
import { DDDOntology, DDDOntologyValidator } from '@telos/ontology-ddd'
import { GitLoader } from '@telos/source-loader-git'
import { KuzuModelRepository } from '@telos/storage-kuzu'
import { composeApp } from './composition.js'
import { ClaudeCodeAgentBinding } from './infrastructure/agent/ClaudeCodeAgentBinding.js'
import { SubprocessSkillRunner } from './infrastructure/agent/SubprocessSkillRunner.js'
import { FsClarifyTicketRepository } from './infrastructure/fs/FsClarifyTicketRepository.js'
import { FsDecisionRepository } from './infrastructure/fs/FsDecisionRepository.js'
import { FsProposalRepository } from './infrastructure/fs/FsProposalRepository.js'
import { FsRunRepository } from './infrastructure/fs/FsRunRepository.js'
import { FsSkillRegistry } from './infrastructure/fs/FsSkillRegistry.js'
import { FsWorkspaceRepository } from './infrastructure/fs/FsWorkspaceRepository.js'
import { WorkspaceRegistryFile } from './infrastructure/fs/WorkspaceRegistryFile.js'

export interface ComposeFsOptions {
  /** Where to persist registered workspace paths. Default `$TELOS_HOME` or `~/.telos`. */
  readonly telosHome?: string
  /** URL the server reports to spawned subprocesses for REST callbacks. */
  readonly apiUrl?: string
  /** Coding-agent model selection (default `opus`). */
  readonly agentModel?: string
  /** Coding-agent effort tier (default `high`). */
  readonly agentEffort?: AgentEffort
}

/**
 * Production composition root: real filesystem persistence for workspaces /
 * proposals / clarify / decisions, built-in skills loaded from `@telos/core`,
 * Claude Code subprocess agent. Model storage uses Kuzu (embedded, zero-infra)
 * per workspace at `<workspace>/.telos/model.kuzu`.
 */
export function composeFsApp(options: ComposeFsOptions = {}): AppDependencies {
  const telosHome = options.telosHome ?? process.env.TELOS_HOME ?? join(homedir(), '.telos')
  const apiUrl = options.apiUrl ?? 'http://localhost:4321'

  const registry = new WorkspaceRegistryFile(join(telosHome, 'workspaces.json'))
  const workspaceRepository = new FsWorkspaceRepository({ registry })
  const workspaceRoots = async (): Promise<ReadonlyMap<WorkspaceId, AbsolutePath>> => {
    const workspaces = await workspaceRepository.list()
    return new Map(workspaces.map(ws => [ws.id, ws.rootPath]))
  }

  const proposalRepository = new FsProposalRepository({ workspaceRoots })
  const clarifyRepository = new FsClarifyTicketRepository({ workspaceRoots })
  const decisionRepository = new FsDecisionRepository({ workspaceRoots })

  const modelRepository = new KuzuModelRepository({
    resolveDbPath: async (workspaceId) => {
      const roots = await workspaceRoots()
      const root = roots.get(workspaceId)
      if (!root)
        throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
      return join(root, '.telos', 'model.kuzu')
    },
  })

  const skillRegistry = new FsSkillRegistry({
    builtinSkillsRoot: builtinSkillsRoot as AbsolutePath,
  })

  const agentBinding = new ClaudeCodeAgentBinding({
    id: 'claude-default' as AgentId,
    kind: 'claude-code' as AgentKind,
    model: options.agentModel ?? 'opus',
    effort: options.agentEffort ?? 'high',
    extraArgs: [],
    env: {},
  })

  const runRepository = new FsRunRepository()

  const pluginRegistry = new PluginRegistry()
  const dddOntology = new DDDOntology()
  pluginRegistry.register(dddOntology)
  pluginRegistry.register(new EvidenceValidator())
  pluginRegistry.register(new OrphanEdgeValidator())
  pluginRegistry.register(new DDDOntologyValidator(dddOntology))
  pluginRegistry.register(new GitLoader())

  const skillRunner = new SubprocessSkillRunner({
    skillRegistry,
    agentBinding,
    apiUrl,
    runRepository,
    referenceDirs: [
      { name: 'shared', path: join(builtinSkillsRoot, 'shared') as AbsolutePath },
    ],
  })

  return composeApp({
    workspaceRepository,
    proposalRepository,
    clarifyRepository,
    decisionRepository,
    modelRepository,
    skillRegistry,
    skillRunner,
    runRepository,
    pluginRegistry,
  })
}
