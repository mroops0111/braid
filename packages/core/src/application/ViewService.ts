import type {
  BlockKind,
  EmittedBlock,
  GeneratedView,
  GenerateViewResponse,
  NodeId,
  SkillId,
  SkillRunId,
  UserId,
  ViewArtifact,
  ViewArtifactFormat,
  ViewContent,
  ViewFormDescriptor,
  ViewFormId,
  ViewKind,
  ViewKindDescriptor,
  WorkspaceId,
} from '@braidhq/schema'
import type { z } from 'zod'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import type { RenderInput, ViewGeneratorPlugin } from '../domain/plugin/ViewGeneratorPlugin.js'
import type { RunRepository } from '../domain/skill/RunRepository.js'
import type { SkillRunner } from '../domain/skill/SkillRunner.js'
import type { ViewPathParts } from '../domain/view/viewPath.js'
import type { ViewRepository } from '../domain/view/ViewRepository.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { ModelService } from './ModelService.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { SkillId as SkillIdSchema } from '@braidhq/schema'
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js'
import { argumentsFor, askedOf, formOfId, unsetRequirements } from '../domain/view/forms.js'
import { viewPathOf, viewPathParts } from '../domain/view/viewPath.js'

export interface ViewServiceDeps {
  pluginRegistry: PluginRegistry
  workspaceService: WorkspaceService
  modelService: ModelService
  viewRepository: ViewRepository
  skillRunner: SkillRunner
  /**
   * Read once a run ends, to take the blocks it rendered as the document.
   * The run's log records what happened and the document is what it made,
   * so the second is lifted out of the first rather than written twice.
   */
  runRepository: RunRepository
  /**
   * What a form's declared requirements are checked against.
   * Read rather than reached for.
   * A test should not have to set a deployment's variable on the process,
   * just to exercise this.
   */
  environment?: Readonly<Record<string, string | undefined>>
}

export interface GenerateViewInput {
  readonly workspaceId: WorkspaceId
  readonly kind: ViewKind
  readonly form: ViewFormId
  readonly subject: NodeId
  readonly asked: Readonly<Record<string, string>>
  readonly startedBy: UserId
  readonly callerToken?: string
}

/**
 * What stands between a view generator and the skill that writes it out.
 *
 * The projection is a function on the plugin,
 * the writing is a skill in a subprocess,
 * and a subprocess cannot call a plugin.
 * Something has to run one and then start the other, and this is it.
 */
export class ViewService {
  constructor(private readonly deps: ViewServiceDeps) {}

  /** Every kind this deployment can write, with the forms it writes it in. */
  kinds(): readonly ViewKindDescriptor[] {
    return this.deps.pluginRegistry.viewGenerators().map(generator => ({
      kind: generator.viewKind,
      subjects: [...(generator.subjects ?? [])],
      forms: [...generator.forms],
    }))
  }

  async list(workspaceId: WorkspaceId): Promise<readonly GeneratedView[]> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const stored = await this.deps.viewRepository.list(workspace)
    const moved = await this.movedOn(workspace, stored.map(view => view.path))

    return stored.flatMap((view) => {
      const parts = viewPathParts(view.path)
      // A file nobody here wrote names no subject and can carry no form,
      // so it is passed over rather than offered as a document.
      if (parts === undefined)
        return []
      // What the form says it writes,
      // since a generator declaring its own output,
      // beats a surface guessing from three characters of a name.
      const declared = this.declaredFormat(parts.kind, parts.form)
      // A file in a format its form no longer writes was left behind,
      // by a version of that form that is gone.
      // Listing it puts two entries under one name,
      // with nothing to tell them apart.
      if (declared !== undefined && declared !== parts.format)
        return []
      return [{
        path: view.path,
        kind: parts.kind,
        form: parts.form,
        subject: parts.subject,
        format: declared ?? parts.format,
        bytes: view.bytes,
        writtenAt: view.writtenAt,
        stale: moved.has(subjectKey(parts.kind, parts.subject)),
      }]
    })
  }

  async read(workspaceId: WorkspaceId, path: string): Promise<ViewContent> {
    const parts = viewPathParts(path)
    if (parts === undefined)
      throw new NotFoundError(`No view at "${path}"`)

    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const blocks = await this.deps.viewRepository.read(workspace, path)
    if (blocks === undefined)
      throw new NotFoundError(`No view at "${path}"`)

    return { path, format: this.declaredFormat(parts.kind, parts.form) ?? parts.format, blocks: [...blocks] }
  }

  /**
   * What the form that wrote this says it writes.
   *
   * Nothing where the form is one this deployment no longer registers.
   * The caller then falls back to the name,
   * which is what is actually true about a file nobody can ask about.
   */
  private declaredFormat(kind: ViewKind, form: ViewFormId): ViewArtifactFormat | undefined {
    const generator = this.deps.pluginRegistry.findViewGenerator(kind)
    return generator === undefined ? undefined : formOfId(generator.forms, form)?.format
  }

  /**
   * The skill a form runs to write its document.
   *
   * Exposed so a caller can ask who may run it before anything is projected,
   * since writing a document is that skill run,
   * and permission to write one is permission to run it.
   * Refuses an unknown kind or form the way `generate` does,
   * so a bad request is answered as a bad request rather than as a refusal.
   */
  skillIdFor(kind: ViewKind, form: ViewFormId): SkillId {
    const generator = this.deps.pluginRegistry.requireViewGenerator(kind)
    return skillFor(generator, this.requireForm(generator, kind, form).id)
  }

  private requireForm(generator: ViewGeneratorPlugin, kind: ViewKind, form: ViewFormId): ViewFormDescriptor {
    const match = formOfId(generator.forms, form)
    if (match === undefined) {
      const named = generator.forms.map(one => one.id).join(', ')
      throw new ValidationError(`A "${kind}" view is written in one of ${named}`)
    }
    return match
  }

  /**
   * Project the subject, then set a form writing it out.
   *
   * Writing takes a minute or so,
   * so the run is handed back for the caller to watch rather than waited on.
   */
  async generate(input: GenerateViewInput): Promise<GenerateViewResponse> {
    const generator = this.deps.pluginRegistry.requireViewGenerator(input.kind)
    const form = this.requireForm(generator, input.kind, input.form)

    const environment = this.deps.environment ?? {}
    const unset = unsetRequirements(form, environment)
    if (unset.length > 0)
      throw new ConflictError(`Writing this view needs ${unset.join(' and ')} set.`)

    const workspace = await this.deps.workspaceService.findById(input.workspaceId)
    const artifact = await this.project(generator, workspace, input.subject)
    const [material] = await this.deps.viewRepository.writeMaterial(workspace, artifact.files)
    if (material === undefined)
      throw new NotFoundError(`Nothing was projected out of "${input.subject}"`)

    const asked = askedOf(form, input.asked)
    const settings = Object.fromEntries(
      form.requires.map(name => [name, environment[name] ?? '']),
    )
    const runId: SkillRunId = await this.deps.skillRunner.start(
      workspace,
      skillFor(generator, form.id),
      argumentsFor(material, asked),
      {
        startedBy: input.startedBy,
        scope: input.subject,
        ...(Object.keys(settings).length > 0 ? { extraEnv: settings } : {}),
        ...(input.callerToken !== undefined ? { callerToken: input.callerToken } : {}),
      },
    )

    // Watched rather than waited on.
    // The reader is handed the run,
    // and the document appears when the run that writes it ends.
    void this.keep(workspace, runId, {
      kind: input.kind,
      form: form.id,
      subject: input.subject,
      format: form.format,
    })

    return { runId, form: form.id, asked, material }
  }

  /**
   * The shape a plugin declared for one of its own block kinds.
   * Nothing back means nobody claims it, and the block is refused.
   */
  blockKindSchema(kind: BlockKind): z.ZodTypeAny | undefined {
    for (const generator of this.deps.pluginRegistry.viewGenerators()) {
      const declared = generator.blockKinds?.find(one => one.kind === kind)
      if (declared !== undefined)
        return declared.schema
    }
    return undefined
  }

  /**
   * Take what a finished run rendered and keep it as the document.
   *
   * The run is subscribed to for the ending alone,
   * then its own event log is read back,
   * so a block emitted before the subscription attached is not lost.
   *
   * A run that ends having rendered nothing writes no document.
   * A reader is better served by the one they already had, or by none,
   * than by an empty page that says the work succeeded.
   */
  private async keep(
    workspace: Workspace,
    runId: SkillRunId,
    parts: ViewPathParts,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      const subscription = this.deps.skillRunner.subscribe(runId, (event) => {
        if (event.type !== 'completed')
          return
        subscription.unsubscribe()
        resolve()
      })
    })

    const blocks: EmittedBlock[] = []
    for await (const event of this.deps.runRepository.readEvents(workspace, runId)) {
      if (event.type === 'block')
        blocks.push({ id: event.id, block: event.block })
    }
    if (blocks.length === 0)
      return

    await this.deps.viewRepository.write(workspace, viewPathOf(parts), blocks)
  }

  /**
   * What a subject would be projected into now, without writing any of it.
   *
   * The projection is a function,
   * so asking what it would say costs a walk of the graph and nothing else.
   * That is what lets a view be told it has gone stale,
   * by comparing this against what it was written from.
   */
  private async project(
    generator: ViewGeneratorPlugin,
    workspace: Workspace,
    subject: NodeId,
  ): Promise<ViewArtifact> {
    return generator.render({ ...await this.graphOf(workspace), config: { subject } })
  }

  private async graphOf(workspace: Workspace): Promise<Omit<RenderInput, 'config'>> {
    const model = await this.deps.modelService.getSnapshot(workspace.id)
    const ontology = this.deps.pluginRegistry.requireOntology(workspace.productManifest.ontologyId)
    return { model, nodeTypes: ontology.nodeTypes }
  }

  /**
   * Which subjects have moved on since a view of one was written.
   *
   * Compared against the material rather than against the graph,
   * so a change touching nothing a reader would read leaves a view current.
   * Said over the subject rather than over each form,
   * because one subject projects into one material,
   * so every form of it goes out of date together or not at all.
   */
  private async movedOn(
    workspace: Workspace,
    paths: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const subjects = new Map<string, { kind: ViewKind, subject: NodeId }>()
    for (const path of paths) {
      const parts = viewPathParts(path)
      if (parts !== undefined)
        subjects.set(subjectKey(parts.kind, parts.subject), parts)
    }

    if (subjects.size === 0)
      return new Set()

    const graph = await this.graphOf(workspace)
    const moved = new Set<string>()
    for (const [key, { kind, subject }] of subjects) {
      const generator = this.deps.pluginRegistry.findViewGenerator(kind)
      if (generator === undefined)
        continue
      const projected = (await generator.render({ ...graph, config: { subject } })).files[0]
      if (projected === undefined)
        continue
      const written = await this.deps.viewRepository.readMaterial(workspace, projected.path)
      // Material nobody kept says nothing either way,
      // and a document called stale on a guess is one a reader ignores.
      if (written !== undefined && written !== projected.text)
        moved.add(key)
    }
    return moved
  }
}

function skillFor(generator: ViewGeneratorPlugin, form: ViewFormId): SkillId {
  return SkillIdSchema.parse(`${generator.skillNamespace ?? generator.viewKind}:${form}`)
}

function subjectKey(kind: ViewKind, subject: NodeId): string {
  return `${kind}/${subject}`
}
