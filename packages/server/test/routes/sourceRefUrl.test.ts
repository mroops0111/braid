import type { PluginRegistry, SourceLoaderPlugin, SourceSyncStateRepository, SourceWebUrlInput } from '@braidhq/core'
import type { AbsolutePath, SourceId } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composeApp.js'
import { makeWorkspace } from '../helpers/fakes.js'

const SEEN: SourceWebUrlInput[] = []

function loaderRecording(): SourceLoaderPlugin {
  return {
    id: 'source-loader.fake' as SourceLoaderPlugin['id'],
    type: 'source-loader',
    kind: 'fake' as SourceLoaderPlugin['kind'],
    provision: async () => { throw new Error('not used') },
    webUrlFor: (input: SourceWebUrlInput) => {
      SEEN.push(input)
      return `https://example.test/${input.unitPath}`
    },
  } as unknown as SourceLoaderPlugin
}

async function buildApp(options: { withLoader: boolean, revision?: string }) {
  SEEN.length = 0
  const rootPath = (await mkdtemp(join(tmpdir(), 'braid-refurl-'))) as AbsolutePath
  const workspace = makeWorkspace({ rootPath })
  workspace.toData().productManifest.sources = [{
    kind: 'filesystem',
    id: 'app' as SourceId,
    role: 'code' as never,
    name: 'app',
    path: './codebases/app' as AbsolutePath,
    loader: { kind: 'fake' as never, config: {} },
  }] as never

  const loader = loaderRecording()
  const pluginRegistry = {
    ontologies: () => [],
    findSourceLoader: (kind: string) => (options.withLoader && kind === 'fake' ? loader : undefined),
  } as unknown as PluginRegistry
  const syncStateRepository = {
    find: async () => (options.revision ? { revision: options.revision } : null),
  } as unknown as SourceSyncStateRepository

  const deps = composeApp({ pluginRegistry, sourceSyncStateRepository: syncStateRepository })
  await deps.workspaceRepository.save(workspace)
  return { app: createApp(deps), workspace }
}

async function resolve(app: ReturnType<typeof createApp>, workspaceId: string, body: unknown) {
  const response = await app.request(`/workspaces/${workspaceId}/source-refs/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as { url: string | null } }
}

describe('source reference urls', () => {
  it('hands the loader a path relative to the source, not to the workspace', async () => {
    const { app, workspace } = await buildApp({ withLoader: true })

    await resolve(app, workspace.id, {
      sourceId: 'app',
      location: { uri: 'codebases/app/src/a.rb', startLine: 3 },
    })

    expect(SEEN[0]?.unitPath).toBe('src/a.rb')
  })

  it('passes the synced revision through so a link can be pinned', async () => {
    const { app, workspace } = await buildApp({ withLoader: true, revision: 'sha-1' })

    await resolve(app, workspace.id, { sourceId: 'app', location: { uri: 'codebases/app/x.rb' } })

    expect(SEEN[0]?.revision).toBe('sha-1')
  })

  it('answers null rather than failing when the loader cannot address a host', async () => {
    const { app, workspace } = await buildApp({ withLoader: false })

    const result = await resolve(app, workspace.id, { sourceId: 'app', location: { uri: 'codebases/app/x.rb' } })

    expect(result.status).toBe(200)
    expect(result.body.url).toBeNull()
  })

  it('answers null for a source the workspace does not declare', async () => {
    const { app, workspace } = await buildApp({ withLoader: true })

    const result = await resolve(app, workspace.id, { sourceId: 'missing', location: { uri: 'x' } })

    expect(result.body.url).toBeNull()
  })
})
