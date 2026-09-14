import type { BlockId, EmittedBlock, NodeId, SkillEvent, SkillId, SkillRunId, UserId, ViewArtifactFile, ViewArtifactFormat, ViewFormId, WorkspaceId } from '@braidhq/schema'
import type { ViewGeneratorPlugin } from '../../src/domain/plugin/ViewGeneratorPlugin.js'
import type { StoredView, ViewRepository } from '../../src/domain/view/ViewRepository.js'
import type { Workspace } from '../../src/domain/workspace/Workspace.js'
import { FIXTURE_FORM, FIXTURE_FORMAT, FIXTURE_KIND, inertRunRepository, inertSkillRunner, makeOntology, makeViewForm, makeViewGenerator, makeWorkspace } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ModelService } from '../../src/application/ModelService.js'
import { ViewService } from '../../src/application/ViewService.js'
import { WorkspaceService } from '../../src/application/WorkspaceService.js'
import { ConflictError, NotFoundError, ValidationError } from '../../src/domain/errors.js'
import { PluginRegistry } from '../../src/domain/plugin/PluginRegistry.js'
import { InMemoryModelRepository } from '../../src/infrastructure/in-memory/InMemoryModelRepository.js'
import { InMemoryWorkspaceRepository } from '../../src/infrastructure/in-memory/InMemoryWorkspaceRepository.js'

const WORKSPACE_ID = 'ws-1' as WorkspaceId
const KIND = FIXTURE_KIND
const FORM = FIXTURE_FORM
const UNDER = `${FIXTURE_KIND}/${FIXTURE_FORM}`
const AT = '2026-01-01T00:00:00.000Z'

/**
 * What a projection writes, which is not what a form writes.
 *
 * The two differ on purpose here,
 * so a test cannot pass by confusing the material with the document.
 */
const MATERIAL_FORMAT = 'material' as ViewArtifactFormat

function materialPathOf(subject: string): string {
  return `material/${KIND}/${subject}.json`
}

class FakeViewRepository implements ViewRepository {
  stored: StoredView[] = []
  material = new Map<string, string>()
  written: ViewArtifactFile[] = []
  contents = new Map<string, readonly EmittedBlock[]>()

  async list(): Promise<readonly StoredView[]> {
    return this.stored
  }

  async read(_workspace: Workspace, path: string): Promise<readonly EmittedBlock[] | undefined> {
    return this.contents.get(path)
  }

  async write(_workspace: Workspace, path: string, blocks: readonly EmittedBlock[]): Promise<void> {
    this.contents.set(path, blocks)
  }

  async writeMaterial(_workspace: Workspace, files: readonly ViewArtifactFile[]): Promise<readonly string[]> {
    this.written.push(...files)
    return files.map(file => `artifacts/${file.path}`)
  }

  async readMaterial(_workspace: Workspace, path: string): Promise<string | undefined> {
    return this.material.get(path)
  }
}

function generator(overrides: { text?: string, requires?: readonly string[] } = {}): ViewGeneratorPlugin {
  return makeViewGenerator({
    forms: [makeViewForm({ requires: overrides.requires ?? [] })],
    render: async ({ config }) => ({
      kind: KIND,
      format: MATERIAL_FORMAT,
      files: [{
        path: materialPathOf((config as { subject: string }).subject),
        text: overrides.text ?? 'projected',
      }],
    }),
  })
}

/** A projection that lands nothing, for the cases about what happens then. */
function projectsNothing(): ViewGeneratorPlugin {
  return makeViewGenerator({
    forms: [makeViewForm()],
    render: async () => ({ kind: KIND, format: MATERIAL_FORMAT, files: [] }),
  })
}

function build(options: { generator?: ViewGeneratorPlugin, environment?: Record<string, string | undefined> } = {}) {
  const pluginRegistry = new PluginRegistry()
  pluginRegistry.register(makeOntology({ ontologyId: 'ddd' }))
  pluginRegistry.register(options.generator ?? generator())

  const workspaceRepository = new InMemoryWorkspaceRepository()
  const workspace = makeWorkspace({ id: WORKSPACE_ID })
  void workspaceRepository.save(workspace)

  const viewRepository = new FakeViewRepository()
  // The run ends as soon as anything subscribes,
  // so a test does not have to drive a subprocess,
  // to see what the service keeps afterwards.
  const listeners: ((event: SkillEvent) => void)[] = []
  const skillRunner = {
    ...inertSkillRunner(),
    start: vi.fn(async () => 'run-1' as SkillRunId),
    subscribe: (_runId: SkillRunId, listener: (event: SkillEvent) => void) => {
      listeners.push(listener)
      return { unsubscribe: () => {}, positionAtSubscribe: 0 }
    },
  }
  const emit = (event: SkillEvent): void => {
    for (const listener of listeners)
      listener(event)
  }
  const finish = (): void => {
    emit({ type: 'completed', runId: 'run-1' as SkillRunId, exitCode: 0, at: AT })
  }

  const rendered: EmittedBlock[] = []
  const runRepository = {
    ...inertRunRepository(),
    readEvents: () => ({
      async *[Symbol.asyncIterator]() {
        for (const emitted of rendered)
          yield { type: 'block', ...emitted } as SkillEvent
      },
    }),
  }

  const service = new ViewService({
    pluginRegistry,
    workspaceService: new WorkspaceService({ workspaceRepository, pluginRegistry }),
    modelService: new ModelService({ modelRepository: new InMemoryModelRepository() }),
    viewRepository,
    skillRunner,
    runRepository,
    ...(options.environment ? { environment: options.environment } : {}),
  })

  return { service, viewRepository, skillRunner, rendered, emit, finish }
}

function block(markdown: string): EmittedBlock {
  return { id: 'b-1' as BlockId, block: { call: 'showAnswer', markdown, audiences: [] } }
}

/** Let the promise chain inside `keep` settle before asserting on it. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1)
    await Promise.resolve()
}

describe('ViewService.kinds', () => {
  it('reports every registered generator with the forms it writes', () => {
    const { service } = build()
    expect(service.kinds()).toEqual([{
      kind: KIND,
      subjects: [],
      forms: [expect.objectContaining({ id: FORM })],
    }])
  })
})

describe('ViewService.generate', () => {
  it('writes the material, then starts the form\'s skill on it', async () => {
    const { service, viewRepository, skillRunner } = build()

    const started = await service.generate({
      workspaceId: WORKSPACE_ID,
      kind: KIND,
      form: FORM,
      subject: 'ctx' as NodeId,
      asked: {},
      startedBy: 'u-1' as UserId,
    })

    expect(viewRepository.written).toHaveLength(1)
    expect(started.material).toBe(`artifacts/${materialPathOf('ctx')}`)
    expect(skillRunner.start).toHaveBeenCalledWith(
      expect.anything(),
      `${KIND}:${FORM}` as SkillId,
      `artifacts/${materialPathOf('ctx')}`,
      expect.objectContaining({ startedBy: 'u-1', scope: 'ctx' }),
    )
  })

  it('refuses when the projection wrote no material for the form to read', async () => {
    const { service } = build({
      generator: projectsNothing(),
    })
    await expect(service.generate({
      workspaceId: WORKSPACE_ID,
      kind: KIND,
      form: FORM,
      subject: 'ctx' as NodeId,
      asked: {},
      startedBy: 'u-1' as UserId,
    })).rejects.toThrow(NotFoundError)
  })

  it('hands a form its declared settings, taken from the deployment', async () => {
    const { service, skillRunner } = build({
      generator: generator({ requires: ['FORM_ROOT'] }),
      environment: { FORM_ROOT: '/root' },
    })
    await service.generate({
      workspaceId: WORKSPACE_ID,
      kind: KIND,
      form: FORM,
      subject: 'ctx' as NodeId,
      asked: {},
      startedBy: 'u-1' as UserId,
      callerToken: 'token-1',
    })
    expect(skillRunner.start).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ extraEnv: { FORM_ROOT: '/root' }, callerToken: 'token-1' }),
    )
  })

  it('refuses a form the generator does not ship', async () => {
    const { service } = build()
    await expect(service.generate({
      workspaceId: WORKSPACE_ID,
      kind: KIND,
      form: 'absent' as ViewFormId,
      subject: 'ctx' as NodeId,
      asked: {},
      startedBy: 'u-1' as UserId,
    })).rejects.toThrow(ValidationError)
  })

  it('refuses before starting a run when a required setting is unset', async () => {
    const { service, skillRunner } = build({
      generator: generator({ requires: ['FORM_ROOT'] }),
      environment: {},
    })

    await expect(service.generate({
      workspaceId: WORKSPACE_ID,
      kind: KIND,
      form: FORM,
      subject: 'ctx' as NodeId,
      asked: {},
      startedBy: 'u-1' as UserId,
    })).rejects.toThrow(ConflictError)
    expect(skillRunner.start).not.toHaveBeenCalled()
  })
})

describe('ViewService.list', () => {
  let built: ReturnType<typeof build>

  beforeEach(() => {
    built = build()
    built.viewRepository.stored = [{
      path: `${UNDER}/ctx.${FIXTURE_FORMAT}`,
      bytes: 10,
      writtenAt: '2026-01-01T00:00:00.000Z',
    }]
  })

  it('names the subject and the format the form declares', async () => {
    built.viewRepository.material.set(materialPathOf('ctx'), 'projected')
    const [view] = await built.service.list(WORKSPACE_ID)
    expect(view).toMatchObject({ subject: 'ctx', form: FORM, format: FIXTURE_FORMAT, stale: false })
  })

  it('marks a document stale once the projection would say something else', async () => {
    built.viewRepository.material.set(materialPathOf('ctx'), 'what it used to say')
    const [view] = await built.service.list(WORKSPACE_ID)
    expect(view?.stale).toBe(true)
  })

  it('does not call a document stale when no material was kept', async () => {
    const [view] = await built.service.list(WORKSPACE_ID)
    expect(view?.stale).toBe(false)
  })

  it('passes over a file in a format this form no longer writes', async () => {
    built.viewRepository.stored = [
      { path: `${UNDER}/ctx.${FIXTURE_FORMAT}`, bytes: 10, writtenAt: '2026-01-01T00:00:00.000Z' },
      { path: `${UNDER}/ctx.other`, bytes: 10, writtenAt: '2026-01-01T00:00:00.000Z' },
    ]
    const listed = await built.service.list(WORKSPACE_ID)
    expect(listed.map(view => view.path)).toEqual([`${UNDER}/ctx.${FIXTURE_FORMAT}`])
  })

  it('does not call a document stale when its kind has no generator left', async () => {
    built.viewRepository.stored = [{
      path: `gone-kind/gone-form/ctx.${FIXTURE_FORMAT}`,
      bytes: 10,
      writtenAt: '2026-01-01T00:00:00.000Z',
    }]
    const [view] = await built.service.list(WORKSPACE_ID)
    expect(view?.stale).toBe(false)
  })

  it('does not call a document stale when the projection produced no file', async () => {
    const built = build({ generator: projectsNothing() })
    built.viewRepository.stored = [{
      path: `${UNDER}/ctx.${FIXTURE_FORMAT}`,
      bytes: 10,
      writtenAt: '2026-01-01T00:00:00.000Z',
    }]
    const [view] = await built.service.list(WORKSPACE_ID)
    expect(view?.stale).toBe(false)
  })

  it('passes over a file nobody here wrote', async () => {
    built.viewRepository.stored = [{ path: 'stray.txt', bytes: 1, writtenAt: '2026-01-01T00:00:00.000Z' }]
    expect(await built.service.list(WORKSPACE_ID)).toEqual([])
  })
})

describe('ViewService keeps what a run rendered', () => {
  async function generate(built: ReturnType<typeof build>): Promise<void> {
    await built.service.generate({
      workspaceId: WORKSPACE_ID,
      kind: KIND,
      form: FORM,
      subject: 'ctx' as NodeId,
      asked: {},
      startedBy: 'u-1' as UserId,
    })
  }

  it('writes the blocks as the document once the run ends', async () => {
    const built = build()
    built.rendered.push(block('the opening passage'))
    await generate(built)
    built.finish()
    await settle()

    expect(built.viewRepository.contents.get(`${UNDER}/ctx.${FIXTURE_FORMAT}`)).toEqual([block('the opening passage')])
  })

  it('waits for the run to end rather than writing on its first event', async () => {
    const built = build()
    built.rendered.push(block('the opening passage'))
    await generate(built)
    built.emit({ type: 'message', role: 'agent', text: 'still working' })
    await settle()
    expect(built.viewRepository.contents.size).toBe(0)

    built.finish()
    await settle()
    expect(built.viewRepository.contents.size).toBe(1)
  })

  it('writes nothing for a run that rendered nothing', async () => {
    const built = build()
    await generate(built)
    built.finish()
    await settle()

    expect(built.viewRepository.contents.size).toBe(0)
  })
})

describe('ViewService.blockKindSchema', () => {
  it('finds nothing for a kind no plugin declares', () => {
    const { service } = build()
    expect(service.blockKindSchema('exam.question' as never)).toBeUndefined()
  })

  it('finds the shape the plugin that ships the kind declared', () => {
    const shape = z.object({ prompt: z.string() })
    const { service } = build({
      generator: { ...generator(), blockKinds: [{ kind: 'exam.question' as never, schema: shape }] },
    })
    expect(service.blockKindSchema('exam.question' as never)).toBe(shape)
  })
})

describe('ViewService.read', () => {
  it('answers with the blocks and the declared format', async () => {
    const { service, viewRepository } = build()
    viewRepository.contents.set(`${UNDER}/ctx.${FIXTURE_FORMAT}`, [block('hi')])
    expect(await service.read(WORKSPACE_ID, `${UNDER}/ctx.${FIXTURE_FORMAT}`))
      .toEqual({ path: `${UNDER}/ctx.${FIXTURE_FORMAT}`, format: FIXTURE_FORMAT, blocks: [block('hi')] })
  })

  it('refuses a path that names no view', async () => {
    const { service } = build()
    await expect(service.read(WORKSPACE_ID, '../../etc/passwd')).rejects.toThrow(NotFoundError)
  })

  it('refuses a view nothing has written', async () => {
    const { service } = build()
    await expect(service.read(WORKSPACE_ID, `${UNDER}/gone.${FIXTURE_FORMAT}`)).rejects.toThrow(NotFoundError)
  })
})
