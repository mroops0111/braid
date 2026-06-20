import type { SourceLoaderPlugin } from '@braidhq/core'
import type { ListSourceLoadersResponse, LoaderKind, PluginId } from '@braidhq/schema'
import { PluginRegistry } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composition.js'

function makeSourceLoader(kind: string, pluginId?: string): SourceLoaderPlugin {
  return {
    id: (pluginId ?? `source-loader.${kind}`) as PluginId,
    type: 'source-loader',
    kind: kind as LoaderKind,
    configSchema: z.object({}),
    ingest: async () => ({
      localPath: '/tmp/x' as never,
      fetchedAt: '2026-01-01T00:00:00Z' as never,
    }),
  }
}

function makeApp(pluginRegistry: PluginRegistry) {
  const deps = composeApp({ pluginRegistry })
  return createApp(deps)
}

describe('GET /source-loaders', () => {
  it('returns an empty list when the registry has no source-loader plugins', async () => {
    const app = makeApp(new PluginRegistry())

    const response = await app.request('/source-loaders')

    expect(response.status).toBe(200)
    const body = (await response.json()) as ListSourceLoadersResponse
    expect(body.loaders).toEqual([])
  })

  it('returns every registered source-loader, keyed by kind and pluginId', async () => {
    const pluginRegistry = new PluginRegistry()
    pluginRegistry.register(makeSourceLoader('fake-git'))
    pluginRegistry.register(makeSourceLoader('fake-linear', 'source-loader.acme-linear'))

    const app = makeApp(pluginRegistry)
    const response = await app.request('/source-loaders')

    expect(response.status).toBe(200)
    const body = (await response.json()) as ListSourceLoadersResponse
    const byKind = Object.fromEntries(body.loaders.map(l => [l.kind, l.pluginId]))
    expect(byKind).toEqual({
      'fake-git': 'source-loader.fake-git' as PluginId,
      'fake-linear': 'source-loader.acme-linear' as PluginId,
    })
  })

  it('only returns source-loader plugins; other axes are excluded', async () => {
    const pluginRegistry = new PluginRegistry()
    pluginRegistry.register(makeSourceLoader('fake-git'))
    // A non-source-loader plugin alongside it. The route must filter it out.
    pluginRegistry.register({
      id: 'ontology.tiny' as PluginId,
      type: 'ontology',
      configSchema: z.object({}),
      ontologyId: 'tiny' as never,
      nodeTypes: [],
      edgeTypes: [],
      validators: [],
    } as never)

    const app = makeApp(pluginRegistry)
    const response = await app.request('/source-loaders')

    const body = (await response.json()) as ListSourceLoadersResponse
    expect(body.loaders.map(l => l.kind)).toEqual(['fake-git'])
  })
})
