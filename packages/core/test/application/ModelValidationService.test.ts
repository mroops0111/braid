import type {
  ModelSnapshot,
  NodeStatus,
  NodeTypeId,
  ValidationCode,
  ValidationIssue,
} from '@braidhq/schema'
import type { OntologyValidator } from '../../src/index.js'
import { makeOntology, makeWorkspace } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { ModelValidationService, PluginRegistry } from '../../src/index.js'

const emptySnapshot: ModelSnapshot = { nodes: [], edges: [] }

function staticValidator(issues: readonly ValidationIssue[]): OntologyValidator {
  return { validate: async () => issues }
}

describe('ModelValidationService', () => {
  describe('validate', () => {
    it('returns ok=true when no ontology is registered and no framework issues fire', async () => {
      const registry = new PluginRegistry()
      const service = new ModelValidationService({ pluginRegistry: registry })

      const result = await service.validate(emptySnapshot, makeWorkspace())

      expect(result.ok).toBe(true)
      expect(result.issues).toEqual([])
    })

    it('aggregates issues from the active ontology validators', async () => {
      const registry = new PluginRegistry()
      registry.register(makeOntology({
        ontologyId: 'ddd',
        validators: [
          staticValidator([{ code: 'A1' as ValidationCode, severity: 'warning', message: 'soft' }]),
          staticValidator([{ code: 'B1' as ValidationCode, severity: 'error', message: 'hard' }]),
        ],
      }))
      const service = new ModelValidationService({ pluginRegistry: registry })

      const result = await service.validate(emptySnapshot, makeWorkspace())

      expect(result.issues.some(issue => issue.code === ('A1' as ValidationCode))).toBe(true)
      expect(result.issues.some(issue => issue.code === ('B1' as ValidationCode))).toBe(true)
    })

    it('reports ok when the ontology returns only warnings and info', async () => {
      const registry = new PluginRegistry()
      registry.register(makeOntology({
        ontologyId: 'ddd',
        validators: [staticValidator([
          { code: 'A1' as ValidationCode, severity: 'warning', message: 'soft' },
          { code: 'A2' as ValidationCode, severity: 'info', message: 'fyi' },
        ])],
      }))
      const service = new ModelValidationService({ pluginRegistry: registry })

      const result = await service.validate(emptySnapshot, makeWorkspace())

      expect(result.ok).toBe(true)
    })

    it('reports not-ok when any issue is an error', async () => {
      const registry = new PluginRegistry()
      registry.register(makeOntology({
        ontologyId: 'ddd',
        validators: [staticValidator([
          { code: 'A1' as ValidationCode, severity: 'warning', message: 'soft' },
          { code: 'A2' as ValidationCode, severity: 'error', message: 'fail' },
        ])],
      }))
      const service = new ModelValidationService({ pluginRegistry: registry })

      const result = await service.validate(emptySnapshot, makeWorkspace())

      expect(result.ok).toBe(false)
    })
  })

  describe('validateOperations', () => {
    it('previews operations and runs ontology validators on next state', async () => {
      const registry = new PluginRegistry()
      let observedNodeCount = -1
      registry.register(makeOntology({
        ontologyId: 'ddd',
        nodeTypes: [{ id: 'command' as NodeTypeId, label: 'Command', description: 'cmd' }],
        validators: [{
          validate: async (snapshot) => {
            observedNodeCount = snapshot.nodes.length
            return []
          },
        }],
      }))
      const service = new ModelValidationService({ pluginRegistry: registry })
      const draft = 'draft' as NodeStatus
      const ops = [
        { operation: 'addNode' as const, payload: { type: 'command' as NodeTypeId, name: 'x', status: draft } },
        { operation: 'addNode' as const, payload: { type: 'command' as NodeTypeId, name: 'y', status: draft } },
      ]

      const result = await service.validateOperations(emptySnapshot, ops, makeWorkspace())

      // Two new nodes without sourceReferences trip the EvidenceValidator (framework invariant).
      expect(result.ok).toBe(false)
      expect(observedNodeCount).toBe(2)
    })
  })
})
