import type { AbsolutePath, SourceId } from '@braidhq/schema'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composeApp.js'
import { makeWorkspace } from '../helpers/fakes.js'

interface Excerpt {
  firstLine: number
  lines: string[]
  highlightFrom: number
  highlightTo: number
  truncated: boolean
}

async function buildApp() {
  const rootPath = (await mkdtemp(join(tmpdir(), 'braid-excerpt-'))) as AbsolutePath
  await mkdir(join(rootPath, 'codebases/app/src'), { recursive: true })
  await writeFile(
    join(rootPath, 'codebases/app/src/a.rb'),
    Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n'),
    'utf8',
  )
  await writeFile(join(rootPath, 'secret.txt'), 'not part of any source', 'utf8')

  const workspace = makeWorkspace({ rootPath })
  workspace.toData().productManifest.sources = [{
    kind: 'filesystem',
    id: 'app' as SourceId,
    role: 'code' as never,
    name: 'app',
    path: './codebases/app' as AbsolutePath,
  }] as never

  const deps = composeApp({})
  await deps.workspaceRepository.save(workspace)
  return { app: createApp(deps), workspace }
}

async function excerpt(app: ReturnType<typeof createApp>, workspaceId: string, body: unknown) {
  const response = await app.request(`/workspaces/${workspaceId}/source-refs/excerpt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Excerpt }
}

describe('source excerpts', () => {
  it('returns the cited lines with context either side', async () => {
    const { app, workspace } = await buildApp()

    const result = await excerpt(app, workspace.id, {
      sourceId: 'app',
      uri: 'codebases/app/src/a.rb',
      startLine: 10,
      endLine: 12,
    })

    expect(result.status).toBe(200)
    expect(result.body.firstLine).toBe(6)
    expect(result.body.lines[0]).toBe('line 6')
    // The highlight points back at the cited range inside the window.
    expect(result.body.lines[result.body.highlightFrom]).toBe('line 10')
    expect(result.body.lines[result.body.highlightTo]).toBe('line 12')
  })

  it('clamps the context window at the top of a file', async () => {
    const { app, workspace } = await buildApp()

    const result = await excerpt(app, workspace.id, {
      sourceId: 'app',
      uri: 'codebases/app/src/a.rb',
      startLine: 2,
    })

    expect(result.body.firstLine).toBe(1)
    expect(result.body.lines[result.body.highlightFrom]).toBe('line 2')
  })

  it('refuses a path that climbs out of its own source', async () => {
    const { app, workspace } = await buildApp()

    const response = await app.request(`/workspaces/${workspace.id}/source-refs/excerpt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'app', uri: 'codebases/app/../../secret.txt', startLine: 1 }),
    })

    expect(response.status).toBe(404)
  })

  it('reports a location the mirror no longer holds', async () => {
    const { app, workspace } = await buildApp()

    const response = await app.request(`/workspaces/${workspace.id}/source-refs/excerpt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'app', uri: 'codebases/app/src/gone.rb', startLine: 1 }),
    })

    expect(response.status).toBe(404)
  })
})
