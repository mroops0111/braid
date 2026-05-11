import type { AbsolutePath, ProductManifest, Workspace as WorkspaceData, WorkspaceId } from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { NotFoundError, Workspace } from '../../../src/index.js'

function manifest(overrides: Partial<ProductManifest> = {}): ProductManifest {
  return {
    name: 'demo',
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: { default: 'claudeCode', tasks: { extract: 'claudeCode', ask: 'anthropicApi' } },
    sources: [],
    ...overrides,
  }
}

function data(overrides: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    id: 'w-1' as WorkspaceId,
    rootPath: '/abs/path' as AbsolutePath,
    productManifest: manifest(),
    pluginConfig: { plugins: [] },
    codeRefs: [
      { name: 'service-a', path: '/abs/code/a' as AbsolutePath },
    ],
    intentRefs: [
      { name: 'prd-folder', path: '/abs/intent' as AbsolutePath },
    ],
    ...overrides,
  }
}

describe('Workspace', () => {
  it('exposes the underlying data', () => {
    const workspace = new Workspace(data())
    expect(workspace.id).toBe('w-1')
    expect(workspace.rootPath).toBe('/abs/path')
    expect(workspace.productManifest.name).toBe('demo')
  })

  describe('resolveAgentForTask', () => {
    it('returns task-specific agent when configured', () => {
      const workspace = new Workspace(data())
      expect(workspace.resolveAgentForTask('ask')).toBe('anthropicApi')
    })

    it('falls back to default agent when task not mapped', () => {
      const workspace = new Workspace(data())
      expect(workspace.resolveAgentForTask('unmapped')).toBe('claudeCode')
    })
  })

  describe('codeRef / intentRef lookups', () => {
    it('finds by name', () => {
      const workspace = new Workspace(data())
      expect(workspace.findCodeRef('service-a')?.path).toBe('/abs/code/a')
      expect(workspace.findIntentRef('prd-folder')?.path).toBe('/abs/intent')
    })

    it('returns undefined when missing', () => {
      const workspace = new Workspace(data())
      expect(workspace.findCodeRef('missing')).toBeUndefined()
    })

    it('requireCodeRef throws NotFoundError', () => {
      const workspace = new Workspace(data())
      expect(() => workspace.requireCodeRef('missing')).toThrow(NotFoundError)
    })

    it('requireCodeRef returns the found ref', () => {
      const workspace = new Workspace(data())
      expect(workspace.requireCodeRef('service-a').name).toBe('service-a')
    })

    it('requireIntentRef returns the found ref', () => {
      const workspace = new Workspace(data())
      expect(workspace.requireIntentRef('prd-folder').name).toBe('prd-folder')
    })

    it('requireIntentRef throws NotFoundError', () => {
      const workspace = new Workspace(data())
      expect(() => workspace.requireIntentRef('missing')).toThrow(NotFoundError)
    })
  })

  it('toData returns the wrapped data unchanged', () => {
    const original = data()
    const workspace = new Workspace(original)
    expect(workspace.toData()).toBe(original)
  })
})
