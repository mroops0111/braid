import type { SourceLoaderPlugin } from '@braidhq/core'
import type { AbsolutePath, Timestamp } from '@braidhq/schema'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCodeAgentPlugin } from '@braidhq/agent-claude-code'
import { PluginRegistry } from '@braidhq/core'
import { AgentKind, LoaderKind, OntologyId, PluginId, StorageKind } from '@braidhq/schema'
import { kuzuStoragePlugin } from '@braidhq/storage-kuzu'
import { makeOntology } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { composeFsApp, composeFsAppWithRegistry } from '../src/composeFsApp.js'
import { readJson } from './helpers/readJson.js'

// Stand-in for a third-party loader, the one plugin such an app brings
// alongside the two it reuses, kuzu storage and the claude-code agent.
const webLoader: SourceLoaderPlugin = {
  id: PluginId.parse('source-loader.web'),
  type: 'source-loader',
  configSchema: z.object({}),
  kind: LoaderKind.parse('web'),
  provision: async (_config, destination: AbsolutePath) => ({
    localPath: destination,
    fetchedAt: new Date().toISOString() as Timestamp,
  }),
}

const knowledgeOntology = makeOntology({
  ontologyId: 'knowledge',
  pluginId: 'ontology.knowledge',
  sourceRoles: [{ id: 'knowledge', unitBearing: true, pathSegment: 'knowledge' }],
})

function thirdPartyRegistry(): PluginRegistry {
  const registry = new PluginRegistry()
  registry.register(kuzuStoragePlugin)
  registry.register(knowledgeOntology)
  registry.register(webLoader)
  registry.register(claudeCodeAgentPlugin)
  return registry
}

async function makeBraidHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'braid-home-'))
}

interface ScaffoldBody {
  workspace: { productManifest: { ontologyId: string } }
}

describe('composeFsAppWithRegistry', () => {
  it('registers only the caller\'s plugins, no ddd ontology and no git, github, or drive loaders', async () => {
    const braidHome = await makeBraidHome()

    const deps = await composeFsAppWithRegistry(thirdPartyRegistry, { braidHome })

    expect(deps.pluginRegistry.findOntology(OntologyId.parse('ddd'))).toBeUndefined()
    expect(deps.pluginRegistry.ontologies().map(o => o.ontologyId)).toEqual(['knowledge'])
    expect(deps.pluginRegistry.sourceLoaders().map(loader => loader.kind)).toEqual(['web'])
  })

  it('wires the same fs runtime as composeFsApp, so batch runs over the reused runner and lister', async () => {
    const braidHome = await makeBraidHome()

    const deps = await composeFsAppWithRegistry(thirdPartyRegistry, { braidHome })

    expect(deps.skillRunner).toBeDefined()
    expect(deps.unitLister).toBeDefined()
    expect(deps.sourceUnitDigest).toBeDefined()
    expect(deps.batchService).toBeDefined()
    expect(deps.historyService).toBeDefined()
    expect(deps.reactorService).toBeDefined()
  })

  it('resolves storage and agent from the caller\'s registry under the requested kinds', async () => {
    const braidHome = await makeBraidHome()

    const deps = await composeFsAppWithRegistry(thirdPartyRegistry, {
      braidHome,
      storageKind: StorageKind.parse('kuzu'),
      agentKind: AgentKind.parse('claude-code'),
    })

    expect(deps.modelRepository).toBeDefined()
    expect(deps.pluginRegistry.findAgentPlugin(AgentKind.parse('claude-code'))).toBeDefined()
  })

  it('scaffolds under the sole registered ontology when the manifest names none', async () => {
    const braidHome = await makeBraidHome()
    const app = createApp(await composeFsAppWithRegistry(thirdPartyRegistry, { braidHome }))

    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'knowledge-demo', manifest: { name: 'knowledge-demo' } }),
    })

    expect(response.status).toBe(201)
    const body = await readJson<ScaffoldBody>(response)
    expect(body.workspace.productManifest.ontologyId).toBe('knowledge')
    const written = await readFile(join(braidHome, 'workspaces', 'knowledge-demo', 'PRODUCT.md'), 'utf-8')
    expect(written).toContain('ontologyId: knowledge')
  })

  it('rejects a scaffold naming an ontology the registry does not hold', async () => {
    const braidHome = await makeBraidHome()
    const app = createApp(await composeFsAppWithRegistry(thirdPartyRegistry, { braidHome }))

    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'wrong-ontology',
        manifest: { name: 'wrong-ontology', ontologyId: 'ddd' },
      }),
    })

    expect(response.status).toBe(400)
  })

  it('honours an explicit defaultOntologyId over the sole-ontology derivation', async () => {
    const braidHome = await makeBraidHome()
    const registry = (): PluginRegistry => {
      const built = thirdPartyRegistry()
      built.register(makeOntology({ ontologyId: 'archive', pluginId: 'ontology.archive' }))
      return built
    }
    const app = createApp(await composeFsAppWithRegistry(registry, {
      braidHome,
      defaultOntologyId: OntologyId.parse('archive'),
    }))

    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'archive-demo', manifest: { name: 'archive-demo' } }),
    })

    expect(response.status).toBe(201)
    const body = await readJson<ScaffoldBody>(response)
    expect(body.workspace.productManifest.ontologyId).toBe('archive')
  })

  it('hands the registry factory the secret store and the resolved urls', async () => {
    const braidHome = await makeBraidHome()
    let seen: { braidHome: string, apiUrl: string, hasSecretStore: boolean } | undefined

    await composeFsAppWithRegistry((context) => {
      seen = {
        braidHome: context.braidHome,
        apiUrl: context.apiUrl,
        hasSecretStore: context.secretStore !== undefined,
      }
      return thirdPartyRegistry()
    }, { braidHome, apiUrl: 'http://localhost:9999' })

    expect(seen).toEqual({ braidHome, apiUrl: 'http://localhost:9999', hasSecretStore: true })
  })
})

describe('composeFsApp', () => {
  it('still bundles the coding preset, kuzu, ddd, the three loaders, and claude-code', async () => {
    const braidHome = await makeBraidHome()

    const deps = await composeFsApp({ braidHome })

    expect(deps.pluginRegistry.ontologies().map(o => o.ontologyId)).toEqual(['ddd'])
    expect(deps.pluginRegistry.sourceLoaders().map(loader => loader.kind).sort())
      .toEqual(['gdrive', 'git', 'github'])
    expect(deps.pluginRegistry.findStoragePlugin(StorageKind.parse('kuzu'))).toBeDefined()
    expect(deps.pluginRegistry.findAgentPlugin(AgentKind.parse('claude-code'))).toBeDefined()
  })

  it('keeps extra plugins additive, alongside the preset defaults', async () => {
    const braidHome = await makeBraidHome()

    const deps = await composeFsApp({ braidHome, extraOntologyPlugins: [knowledgeOntology] })

    expect(deps.pluginRegistry.ontologies().map(o => o.ontologyId).sort()).toEqual(['ddd', 'knowledge'])
  })
})
