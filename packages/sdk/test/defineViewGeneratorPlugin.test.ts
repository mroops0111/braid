import type { ModelSnapshot, ViewArtifact, ViewKind } from '@braidhq/schema'
import { ValidationError } from '@braidhq/core'
import { FIXTURE_FORMAT } from '@braidhq/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineViewGeneratorPlugin } from '../src/defineViewGeneratorPlugin.js'

const stubSnapshot = {} as ModelSnapshot
const stubArtifact: ViewArtifact = { kind: 'mermaid' as ViewKind, format: FIXTURE_FORMAT, files: [] }

const oneForm = [{
  id: 'diagram',
  label: 'Diagram',
  purpose: 'Draw the graph as a picture',
  format: FIXTURE_FORMAT,
  directory: '/plugins/mermaid/skills/diagram',
}]

describe('defineViewGeneratorPlugin', () => {
  it('builds a frozen plugin with view-generator.<viewKind> as the default id', () => {
    const plugin = defineViewGeneratorPlugin({
      viewKind: 'mermaid',
      configSchema: z.object({}),
      forms: oneForm,
      render: async () => stubArtifact,
    })
    expect(plugin.id).toBe('view-generator.mermaid')
    expect(plugin.type).toBe('view-generator')
    expect(plugin.viewKind).toBe('mermaid' as ViewKind)
    expect(Object.isFrozen(plugin)).toBe(true)
  })

  it('derives the skills from the forms, so the two cannot drift', () => {
    const plugin = defineViewGeneratorPlugin({
      viewKind: 'mermaid',
      configSchema: z.object({}),
      forms: oneForm,
      render: async () => stubArtifact,
    })
    expect(plugin.forms.map(form => form.id)).toEqual(['diagram'])
    expect(plugin.skills).toEqual([{ directory: '/plugins/mermaid/skills/diagram' }])
  })

  it('namespaces the forms under the view kind unless told otherwise', () => {
    const byDefault = defineViewGeneratorPlugin({
      viewKind: 'mermaid',
      configSchema: z.object({}),
      forms: oneForm,
      render: async () => stubArtifact,
    })
    const named = defineViewGeneratorPlugin({
      viewKind: 'mermaid',
      skillNamespace: 'acme',
      configSchema: z.object({}),
      forms: oneForm,
      render: async () => stubArtifact,
    })
    expect(byDefault.skillNamespace).toBe('mermaid')
    expect(named.skillNamespace).toBe('acme')
  })

  it('parses config through the schema before calling render', async () => {
    const renderSpy = vi.fn(async () => stubArtifact)
    const plugin = defineViewGeneratorPlugin({
      viewKind: 'mermaid',
      configSchema: z.object({ direction: z.enum(['LR', 'TB']) }),
      forms: oneForm,
      render: renderSpy,
    })

    const renderInput = { model: stubSnapshot, nodeTypes: [], config: { direction: 'LR' } }
    await plugin.render(renderInput)

    expect(renderSpy).toHaveBeenCalledOnce()
    expect(renderSpy).toHaveBeenCalledWith({ direction: 'LR' }, renderInput)
  })

  it('rejects render calls whose config fails the schema', async () => {
    const plugin = defineViewGeneratorPlugin({
      viewKind: 'mermaid',
      configSchema: z.object({ direction: z.enum(['LR', 'TB']) }),
      forms: oneForm,
      render: async () => stubArtifact,
    })

    await expect(
      plugin.render({ model: stubSnapshot, nodeTypes: [], config: { direction: 'diagonal' } }),
    ).rejects.toThrow()
  })

  it('throws ValidationError on empty viewKind at build time', () => {
    expect(() => defineViewGeneratorPlugin({
      viewKind: '',
      configSchema: z.object({}),
      forms: oneForm,
      render: async () => stubArtifact,
    })).toThrow(ValidationError)
  })

  it('refuses a generator with no form, since nothing would write it out', () => {
    expect(() => defineViewGeneratorPlugin({
      viewKind: 'mermaid',
      configSchema: z.object({}),
      forms: [],
      render: async () => stubArtifact,
    })).toThrow(/at least one form/)
  })

  it('honours an explicit pluginId override', () => {
    const plugin = defineViewGeneratorPlugin({
      viewKind: 'mermaid',
      pluginId: 'view-generator.acme-mermaid',
      configSchema: z.object({}),
      forms: oneForm,
      render: async () => stubArtifact,
    })
    expect(plugin.id).toBe('view-generator.acme-mermaid')
  })
})
