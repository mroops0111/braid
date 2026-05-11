import type {
  ClarifyCandidateId,
  ClarifyTicketId,
  NodeId,
  PluginId,
  SkillId,
  UserId,
  ViewArtifact,
  ViewKind,
  WorkspaceId,
} from '@telos/schema'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  AskSkill,
  ClarifySkill,
  ClarifyTicket,
  ExtractionService,
  ExtractSkill,
  GenerateViewSkill,
  GenerationService,
  type Generator,
  HITLService,
  PluginRegistry,
  QAService,
} from '../../src/index.js'
import { FakeEmbeddingIndex } from '../fakes/FakeEmbeddingIndex.js'
import { fakeFactFragment, FakeSource, sourceIdCode } from '../fakes/FakeSource.js'
import { InMemoryClarifyTicketRepository } from '../fakes/InMemoryClarifyTicketRepository.js'
import { InMemoryDecisionRepository } from '../fakes/InMemoryDecisionRepository.js'
import { InMemoryModelRepository } from '../fakes/InMemoryModelRepository.js'
import { InMemoryProposalRepository } from '../fakes/InMemoryProposalRepository.js'
import { InMemoryQAHistoryRepository } from '../fakes/InMemoryQAHistoryRepository.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00'
const workspaceId = 'w-1' as WorkspaceId
const userId = 'u-1' as UserId

describe('ExtractSkill', () => {
  it('forwards request to ExtractionService and returns a draft', async () => {
    const synthesize = vi.fn(async () => ({
      operations: [],
      generatedBy: 'extract' as SkillId,
      rationale: 'ok',
    }))
    const service = new ExtractionService({ synthesize })
    const skill = new ExtractSkill(service)

    const draft = await skill.execute({
      scope: { tokens: [], pathGlobs: [] },
      intentSources: [],
      codeSources: [new FakeSource(sourceIdCode, 'code', [fakeFactFragment('x', sourceIdCode)])],
    })

    expect(draft.rationale).toBe('ok')
    expect(synthesize).toHaveBeenCalledOnce()
  })
})

describe('AskSkill', () => {
  it('forwards to QAService.ask and returns the QAResult', async () => {
    const service = new QAService({
      modelRepository: new InMemoryModelRepository(),
      embeddingIndex: new FakeEmbeddingIndex(),
      qaHistoryRepository: new InMemoryQAHistoryRepository(),
      embedText: async () => ({ vector: [0.1], modelId: 'm', createdAt: isoTimestamp }),
      generateAnswer: async () => ({ text: 'A', confidence: 0.8, generatedBy: 'agent' }),
    })
    const skill = new AskSkill(service)

    const result = await skill.execute({
      text: 'q',
      workspaceId,
      askedBy: userId,
      channel: 'studio',
    })

    expect(result.answer.text).toBe('A')
  })
})

describe('ClarifySkill', () => {
  it('forwards to HITLService.answerClarifyTicket and persists', async () => {
    const clarifyRepository = new InMemoryClarifyTicketRepository()
    const decisionRepository = new InMemoryDecisionRepository()
    const modelRepository = new InMemoryModelRepository()
    const hitlService = new HITLService({
      proposalRepository: new InMemoryProposalRepository(),
      clarifyRepository,
      decisionRepository,
      modelRepository,
    })

    await modelRepository.applyOperations(workspaceId, [
      { op: 'addNode', payload: { type: 'command', name: 'x', id: 'n-1' as NodeId } as never },
    ])

    await clarifyRepository.save(new ClarifyTicket({
      id: 'ct-1' as ClarifyTicketId,
      question: 'remove?',
      candidates: [{
        id: 'cc-1' as ClarifyCandidateId,
        description: 'yes',
        sourceReferences: [],
        proposedOperations: [{ op: 'removeNode', nodeId: 'n-1' as NodeId }],
      }],
      status: 'pending',
    }))

    const skill = new ClarifySkill(hitlService)
    const decision = await skill.execute({
      clarifyTicketId: 'ct-1',
      candidateId: 'cc-1',
      workspaceId,
      userId,
    })

    expect(decision.action).toBe('answerClarifyTicket')
    expect((await modelRepository.load(workspaceId)).nodes).toEqual([])
  })
})

describe('GenerateViewSkill', () => {
  it('forwards to GenerationService.render', async () => {
    const registry = new PluginRegistry()
    const generator: Generator = {
      id: 'gen-docs' as PluginId,
      type: 'generator',
      viewKind: 'docs' as ViewKind,
      configSchema: z.object({}).passthrough(),
      render: vi.fn(async () => ({
        kind: 'docs' as ViewKind,
        format: 'markdown' as never,
        files: [{ path: 'README.md', text: '# x' }],
      } satisfies ViewArtifact)),
    }
    registry.register(generator as never)

    const service = new GenerationService({
      pluginRegistry: registry,
      modelRepository: new InMemoryModelRepository(),
    })
    const skill = new GenerateViewSkill(service)

    const artifact = await skill.execute({
      workspaceId,
      viewKind: 'docs',
      config: {},
    })

    expect(artifact.files[0]?.path).toBe('README.md')
  })

  it('rejects unknown viewKind by surfacing NotFoundError', async () => {
    const service = new GenerationService({
      pluginRegistry: new PluginRegistry(),
      modelRepository: new InMemoryModelRepository(),
    })
    const skill = new GenerateViewSkill(service)

    await expect(skill.execute({
      workspaceId,
      viewKind: 'unknown',
      config: {},
    })).rejects.toThrow()
  })
})
