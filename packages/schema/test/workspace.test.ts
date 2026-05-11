import { describe, expect, it } from 'vitest'
import { CodeRef, IntentRef, PluginConfig, ProductManifest, Workspace } from '../src/index.js'

describe('codeRef', () => {
  it('parses with optional language', () => {
    const reference = CodeRef.parse({
      name: 'service-a',
      path: '/abs/path',
      language: 'typescript',
    })
    expect(reference.language).toBe('typescript')
  })
  it('language is optional', () => {
    const reference = CodeRef.parse({ name: 'service-a', path: '/abs/path' })
    expect(reference.language).toBeUndefined()
  })
})

describe('intentRef', () => {
  it('parses name + path', () => {
    const reference = IntentRef.parse({ name: 'prd-folder', path: '/abs/intent' })
    expect(reference.name).toBe('prd-folder')
  })
})

describe('pluginConfig', () => {
  it('defaults plugins to empty array', () => {
    expect(PluginConfig.parse({})).toEqual({ plugins: [] })
  })
  it('parses with plugin descriptors', () => {
    const config = PluginConfig.parse({
      plugins: [
        { pluginId: 'source-github', type: 'source', config: {} },
      ],
    })
    expect(config.plugins).toHaveLength(1)
  })
})

describe('productManifest', () => {
  it('parses minimal manifest with defaults', () => {
    const manifest = ProductManifest.parse({
      name: 'demo',
      agents: { default: 'claudeCode' },
    })
    expect(manifest.version).toBe('0.0.0')
    expect(manifest.ontologyId).toBe('ddd')
    expect(manifest.sources).toEqual([])
  })

  it('parses with sources + agents routing', () => {
    const manifest = ProductManifest.parse({
      name: 'demo',
      version: '1.2.3',
      description: 'desc',
      agents: {
        default: 'anthropicApi',
        tasks: { extract: 'claudeCode', ask: 'anthropicApi' },
      },
      sources: [
        { id: 's-1', pluginId: 'source-github', kind: 'code', config: {} },
      ],
    })
    expect(manifest.agents.tasks.ask).toBe('anthropicApi')
  })

  it('rejects empty name', () => {
    expect(
      ProductManifest.safeParse({ name: '', agents: { default: 'x' } }).success,
    ).toBe(false)
  })
})

describe('workspace', () => {
  it('parses a complete workspace', () => {
    const workspace = Workspace.parse({
      id: 'w-1',
      rootPath: '/abs/workspace',
      productManifest: {
        name: 'demo',
        agents: { default: 'claudeCode' },
      },
      pluginConfig: { plugins: [] },
      codeRefs: [{ name: 'svc', path: '/abs/code' }],
      intentRefs: [{ name: 'prd', path: '/abs/prd' }],
    })
    expect(workspace.id).toBe('w-1')
    expect(workspace.codeRefs).toHaveLength(1)
  })

  it('codeRefs / intentRefs default to empty', () => {
    const workspace = Workspace.parse({
      id: 'w-1',
      rootPath: '/abs',
      productManifest: { name: 'demo', agents: { default: 'a' } },
      pluginConfig: { plugins: [] },
    })
    expect(workspace.codeRefs).toEqual([])
    expect(workspace.intentRefs).toEqual([])
  })
})
