import type { StorageDescriptor, StorageKind } from '@telos/schema'
import type { ClarifyTicketRepository } from '../hitl/ClarifyTicketRepository.js'
import type { DecisionRepository } from '../hitl/DecisionRepository.js'
import type { ProposalRepository } from '../hitl/ProposalRepository.js'
import type { ModelRepository } from '../model/ModelRepository.js'
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js'
import type { Plugin, PluginContext } from './Plugin.js'

export interface StorageBackend {
  readonly modelRepository: ModelRepository
  readonly workspaceRepository: WorkspaceRepository
  readonly proposalRepository: ProposalRepository
  readonly clarifyTicketRepository: ClarifyTicketRepository
  readonly decisionRepository: DecisionRepository
  close?: () => Promise<void>
}

export interface StoragePlugin extends Plugin {
  readonly type: 'storage'
  readonly kind: StorageKind
  createBackend: (descriptor: StorageDescriptor, context: PluginContext) => Promise<StorageBackend>
}
