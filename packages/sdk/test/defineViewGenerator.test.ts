import type { ModelSnapshot, ViewArtifact, ViewKind } from '@braidhq/schema'
import { ValidationError } from '@braidhq/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineViewGenerator } from '../src/defineViewGenerator.js'

const stubSnapshot = {} as ModelSnapshot
const stubArtifact = { format: 'markdown', content: 'ok' } as unknown as ViewArtifact

describe('defineViewGenerator', () => {
  it('builds a frozen plugin with view-generator.<viewKind> as the default id', () => {
    const plugin = defineViewGenerator({
      viewKind: 'mermaid',
      configSchema: z.object({}),
      render: async () => stubArtifact,
    })
    expect(plugin.id).toBe('view-generator.mermaid')
    expect(plugin.type).toBe('view-generator')
    expect(plugin.viewKind).toBe('mermaid' as ViewKind)
    expect(Object.isFrozen(plugin)).toBe(true)
  })

  it('parses config through the schema before calling render', async () => {
    const renderSpy = vi.fn(async () => stubArtifact)
    const plugin = defineViewGenerator({
      viewKind: 'mermaid',
      configSchema: z.object({ direction: z.enum(['LR', 'TB']) }),
      render: renderSpy,
    })

    const renderInput = { model: stubSnapshot, config: { direction: 'LR' } }
    await plugin.render(renderInput)

    expect(renderSpy).toHaveBeenCalledOnce()
    expect(renderSpy).toHaveBeenCalledWith({ direction: 'LR' }, renderInput)
  })

  it('rejects render calls whose config fails the schema', async () => {
    const plugin = defineViewGenerator({
      viewKind: 'mermaid',
      configSchema: z.object({ direction: z.enum(['LR', 'TB']) }),
      render: async () => stubArtifact,
    })

    await expect(
      plugin.render({ model: stubSnapshot, config: { direction: 'diagonal' } }),
    ).rejects.toThrow()
  })

  it('throws ValidationError on empty viewKind at build time', () => {
    expect(() => defineViewGenerator({
      viewKind: '',
      configSchema: z.object({}),
      render: async () => stubArtifact,
    })).toThrow(ValidationError)
  })

  it('honours an explicit pluginId override', () => {
    const plugin = defineViewGenerator({
      viewKind: 'mermaid',
      pluginId: 'view-generator.acme-mermaid',
      configSchema: z.object({}),
      render: async () => stubArtifact,
    })
    expect(plugin.id).toBe('view-generator.acme-mermaid')
  })
})
