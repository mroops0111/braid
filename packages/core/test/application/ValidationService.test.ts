import type {
  ModelSnapshot,
  NodeTypeId,
  OntologyId,
  PluginId,
  ValidationCode,
  ValidationIssue,
} from '@braidhq/schema'
import type { OntologyPlugin, OntologyValidator } from '../../src/index.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PluginRegistry, ValidationService } from '../../src/index.js'
import { makeWorkspace } from '../helpers/fakes.js'

function emptySnapshot(): ModelSnapshot {
  return { nodes: [], edges: [] }
}

function makeOntologyWith(validators: readonly OntologyValidator[]): OntologyPlugin {
  return {
    id: 'ontology.test' as PluginId,
    type: 'ontology',
    configSchema: z.object({}),
    ontologyId: 'test' as OntologyId,
    nodeTypes: [],
    edgeTypes: [],
    validators,
  }
}

function staticValidator(issues: readonly ValidationIssue[]): OntologyValidator {
  return { validate: async () => issues }
}

describe('ValidationService', () => {
  it('returns ok=true when no ontology is registered and no framework issues fire', async () => {
    const registry = new PluginRegistry()
    const service = new ValidationService({ pluginRegistry: registry })
    const result = await service.validate(emptySnapshot(), makeWorkspace())
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('aggregates issues from the active ontology validators', async () => {
    const registry = new PluginRegistry()
    registry.register(makeOntologyWith([
      staticValidator([{ code: 'A1' as ValidationCode, severity: 'warning', message: 'soft' }]),
      staticValidator([{ code: 'B1' as ValidationCode, severity: 'error', message: 'hard' }]),
    ]))

    const service = new ValidationService({ pluginRegistry: registry })
    const ws = makeWorkspace({ id: 'ws-test' })
    // Workspace ontologyId is 'ddd' by default; register an ontology matching that
    registry.register({
      id: 'ontology.ddd' as PluginId,
      type: 'ontology',
      configSchema: z.object({}),
      ontologyId: 'ddd' as OntologyId,
      nodeTypes: [],
      edgeTypes: [],
      validators: [
        staticValidator([{ code: 'A1' as ValidationCode, severity: 'warning', message: 'soft' }]),
        staticValidator([{ code: 'B1' as ValidationCode, severity: 'error', message: 'hard' }]),
      ],
    })

    const result = await service.validate(emptySnapshot(), ws)
    // Issues = framework checks (none on empty snapshot) + ontology issues
    expect(result.issues.some(i => i.code === ('A1' as ValidationCode))).toBe(true)
    expect(result.issues.some(i => i.code === ('B1' as ValidationCode))).toBe(true)
  })

  it('ok=true when ontology returns only warnings / info', async () => {
    const registry = new PluginRegistry()
    registry.register({
      id: 'ontology.ddd' as PluginId,
      type: 'ontology',
      configSchema: z.object({}),
      ontologyId: 'ddd' as OntologyId,
      nodeTypes: [],
      edgeTypes: [],
      validators: [
        staticValidator([
          { code: 'A1' as ValidationCode, severity: 'warning', message: 'soft' },
          { code: 'A2' as ValidationCode, severity: 'info', message: 'fyi' },
        ]),
      ],
    })
    const service = new ValidationService({ pluginRegistry: registry })
    const result = await service.validate(emptySnapshot(), makeWorkspace())
    expect(result.ok).toBe(true)
  })

  it('ok=false when at least one error', async () => {
    const registry = new PluginRegistry()
    registry.register({
      id: 'ontology.ddd' as PluginId,
      type: 'ontology',
      configSchema: z.object({}),
      ontologyId: 'ddd' as OntologyId,
      nodeTypes: [],
      edgeTypes: [],
      validators: [
        staticValidator([
          { code: 'A1' as ValidationCode, severity: 'warning', message: 'soft' },
          { code: 'A2' as ValidationCode, severity: 'error', message: 'fail' },
        ]),
      ],
    })
    const service = new ValidationService({ pluginRegistry: registry })
    const result = await service.validate(emptySnapshot(), makeWorkspace())
    expect(result.ok).toBe(false)
  })

  describe('validateOperations', () => {
    it('previews operations and runs ontology validators on next state', async () => {
      const registry = new PluginRegistry()
      let observedNodeCount = -1
      registry.register({
        id: 'ontology.ddd' as PluginId,
        type: 'ontology',
        configSchema: z.object({}),
        ontologyId: 'ddd' as OntologyId,
        nodeTypes: [{ id: 'command' as NodeTypeId, label: 'Command', description: 'cmd' }],
        edgeTypes: [],
        validators: [{
          validate: async (snapshot) => {
            observedNodeCount = snapshot.nodes.length
            return []
          },
        }],
      })

      const service = new ValidationService({ pluginRegistry: registry })
      const ops = [
        { operation: 'addNode' as const, payload: { type: 'command', name: 'x' } as never },
        { operation: 'addNode' as const, payload: { type: 'command', name: 'y' } as never },
      ]
      const result = await service.validateOperations(emptySnapshot(), ops, makeWorkspace())
      expect(result.ok).toBe(false)
      // Two new nodes without sourceReferences trip the EvidenceValidator (framework invariant).
      expect(observedNodeCount).toBe(2)
    })
  })
})
