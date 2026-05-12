import type {
  ModelSnapshot,
  PluginId,
  ValidationCode,
  ValidationIssue,
} from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { PluginRegistry, ValidationService, type Validator } from '../../src/index.js'

function emptySnapshot(): ModelSnapshot {
  return { nodes: [], edges: [] }
}

function makeValidator(id: string, issues: readonly ValidationIssue[]): Validator {
  return {
    id: id as PluginId,
    type: 'validator',
    configSchema: { parse: (value: unknown) => value } as never,
    validate: async () => issues,
  }
}

describe('ValidationService', () => {
  it('returns ok=true when no validators are registered', async () => {
    const registry = new PluginRegistry()
    const service = new ValidationService({ pluginRegistry: registry })
    const result = await service.validate(emptySnapshot())
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('aggregates issues across multiple validators', async () => {
    const registry = new PluginRegistry()
    registry.register(makeValidator('a', [
      { code: 'A1' as ValidationCode, severity: 'warning', message: 'soft' },
    ]))
    registry.register(makeValidator('b', [
      { code: 'B1' as ValidationCode, severity: 'error', message: 'hard' },
    ]))

    const service = new ValidationService({ pluginRegistry: registry })
    const result = await service.validate(emptySnapshot())
    expect(result.issues).toHaveLength(2)
  })

  it('ok=true when only warnings / info', async () => {
    const registry = new PluginRegistry()
    registry.register(makeValidator('a', [
      { code: 'A1' as ValidationCode, severity: 'warning', message: 'soft' },
      { code: 'A2' as ValidationCode, severity: 'info', message: 'fyi' },
    ]))
    const service = new ValidationService({ pluginRegistry: registry })
    const result = await service.validate(emptySnapshot())
    expect(result.ok).toBe(true)
  })

  it('ok=false when at least one error', async () => {
    const registry = new PluginRegistry()
    registry.register(makeValidator('a', [
      { code: 'A1' as ValidationCode, severity: 'warning', message: 'soft' },
      { code: 'A2' as ValidationCode, severity: 'error', message: 'fail' },
    ]))
    const service = new ValidationService({ pluginRegistry: registry })
    const result = await service.validate(emptySnapshot())
    expect(result.ok).toBe(false)
  })

  describe('validateOperations', () => {
    it('previews operations and runs validators on next state', async () => {
      const registry = new PluginRegistry()
      let observedNodeCount = -1
      registry.register({
        id: 'count' as PluginId,
        type: 'validator',
        configSchema: { parse: (value: unknown) => value } as never,
        validate: async (snapshot) => {
          observedNodeCount = snapshot.nodes.length
          return []
        },
      })

      const service = new ValidationService({ pluginRegistry: registry })
      const ops = [
        { operation: 'addNode' as const, payload: { type: 'command', name: 'x' } as never },
        { operation: 'addNode' as const, payload: { type: 'command', name: 'y' } as never },
      ]
      const result = await service.validateOperations(emptySnapshot(), ops)
      expect(result.ok).toBe(true)
      expect(observedNodeCount).toBe(2)
    })
  })
})
