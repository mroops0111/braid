import type { ModelSnapshot, PluginId, ViewArtifact, ViewKind, WorkspaceId } from '@telos/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  GenerationService,
  type Generator,
  NotFoundError,
  PluginRegistry,
} from '../../src/index.js'
import { InMemoryModelRepository } from '../fakes/InMemoryModelRepository.js'

function fakeGenerator(id: string, viewKind: string, render = vi.fn()): Generator {
  return {
    id: id as PluginId,
    type: 'generator',
    viewKind: viewKind as ViewKind,
    configSchema: z.object({}).passthrough(),
    render: render.mockResolvedValue({
      kind: viewKind as ViewKind,
      format: 'markdown' as never,
      files: [{ path: 'README.md', text: '# generated' }],
    } satisfies ViewArtifact),
  }
}

describe('GenerationService', () => {
  let registry: PluginRegistry
  let modelRepository: InMemoryModelRepository
  let service: GenerationService

  beforeEach(() => {
    registry = new PluginRegistry()
    modelRepository = new InMemoryModelRepository()
    service = new GenerationService({
      pluginRegistry: registry,
      modelRepository,
    })
  })

  it('renders via the generator whose viewKind matches', async () => {
    const render = vi.fn()
    registry.register(fakeGenerator('gen-docs', 'docs', render) as never)
    const artifact = await service.render(
      'w-1' as WorkspaceId,
      'docs' as ViewKind,
      { title: 'x' },
    )
    expect(artifact.files[0]?.text).toBe('# generated')
    expect(render).toHaveBeenCalledOnce()
    const passed = render.mock.calls[0]?.[0]
    expect(passed?.model).toEqual({ nodes: [], edges: [] } satisfies ModelSnapshot)
    expect(passed?.config).toEqual({ title: 'x' })
  })

  it('throws NotFoundError when no generator handles the viewKind', async () => {
    registry.register(fakeGenerator('gen-bdd', 'bdd') as never)
    await expect(
      service.render('w-1' as WorkspaceId, 'docs' as ViewKind, {}),
    ).rejects.toThrow(NotFoundError)
  })

  it('listAvailableViewKinds returns every generator viewKind', () => {
    registry.register(fakeGenerator('a', 'docs') as never)
    registry.register(fakeGenerator('b', 'bdd') as never)
    registry.register(fakeGenerator('c', 'mermaid') as never)
    expect(service.listAvailableViewKinds().sort()).toEqual(['bdd', 'docs', 'mermaid'])
  })
})
