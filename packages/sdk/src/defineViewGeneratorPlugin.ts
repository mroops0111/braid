import type { RenderInput, ViewGeneratorPlugin } from '@braidhq/core'
import type { PluginId, ViewArtifact, ViewFormDescriptor, ViewKind, ViewSubjects } from '@braidhq/schema'
import type { z } from 'zod'
import type { PluginReferenceDirRef, PluginSkillRef } from './types.js'
import { ValidationError } from '@braidhq/core'
import { ViewFormDescriptor as ViewFormDescriptorSchema, ViewSubjects as ViewSubjectsSchema } from '@braidhq/schema'
import { assertNonEmpty } from './validation.js'

/**
 * One way of writing this kind out, and where its skill lives.
 *
 * The form and its skill are declared together so they cannot drift.
 * The builder derives the plugin's `skills` from this list,
 * which is what stops a fourth form reaching the runtime,
 * without reaching the reader who would have asked for it.
 */
export interface DefineViewFormInput extends PluginSkillRef {
  readonly id: string
  readonly label: ViewFormDescriptor['label']
  readonly purpose: ViewFormDescriptor['purpose']
  readonly format: ViewFormDescriptor['format']
  readonly asks?: ViewFormDescriptor['asks']
  readonly requires?: readonly string[]
}

export interface DefineViewGeneratorInput<TSchema extends z.ZodTypeAny> {
  readonly viewKind: string
  /** Zod schema for the per-render config, parsed before `render` runs. */
  readonly configSchema: TSchema
  /** Required. Project a model snapshot into a view artifact. */
  readonly render: (config: z.infer<TSchema>, input: RenderInput) => Promise<ViewArtifact>
  /**
   * Which nodes this kind can be written about,
   * narrowed by the hints an ontology declares,
   * or by named types where the plugin ships with one.
   * Omitted takes any node.
   */
  readonly subjects?: ViewSubjects
  /** The forms this kind is written in, each shipping one skill. */
  readonly forms: readonly DefineViewFormInput[]
  /**
   * Namespace for this plugin's skill ids, composed as `<namespace>:<form>`.
   * Defaults to the view kind,
   * which is what a reader of a run's skill id would expect to see,
   * and is what the service asks the registry for.
   */
  readonly skillNamespace?: string
  /** Docs the forms Read but never invoke, such as a shared markup contract. */
  readonly referenceDir?: PluginReferenceDirRef
  /** Optional explicit plugin id, defaults to `view-generator.<viewKind>`. */
  readonly pluginId?: string
}

/**
 * Build a ViewGeneratorPlugin from a declarative spec.
 *
 * The wrapper parses `input.config` against `configSchema` before `render` runs,
 * so the plugin body always receives a statically-typed config object.
 * Mirrors the other `defineXxx` builders,
 * so plugin authors find a uniform entry point across every axis.
 */
export function defineViewGeneratorPlugin<TSchema extends z.ZodTypeAny>(
  input: DefineViewGeneratorInput<TSchema>,
): ViewGeneratorPlugin {
  assertNonEmpty('view-generator viewKind', input.viewKind)
  if (input.forms.length === 0)
    throw new ValidationError('A view generator ships at least one form, else nothing writes it out')

  const parse = (raw: unknown): z.infer<TSchema> => input.configSchema.parse(raw) as z.infer<TSchema>
  const forms = input.forms.map(form => ViewFormDescriptorSchema.parse({
    id: form.id,
    label: form.label,
    purpose: form.purpose,
    format: form.format,
    asks: form.asks ?? [],
    requires: form.requires ?? [],
  }))

  const plugin: ViewGeneratorPlugin & { readonly skills: readonly PluginSkillRef[] } = {
    id: (input.pluginId ?? `view-generator.${input.viewKind}`) as PluginId,
    type: 'view-generator' as const,
    viewKind: input.viewKind as ViewKind,
    configSchema: input.configSchema,
    ...(input.subjects ? { subjects: ViewSubjectsSchema.parse(input.subjects) } : {}),
    forms,
    skills: input.forms.map(form => ({ directory: form.directory })),
    skillNamespace: input.skillNamespace ?? input.viewKind,
    ...(input.referenceDir ? { referenceDir: input.referenceDir } : {}),
    // `async` so that a parse error surfaces as a rejected promise,
    // not a synchronous throw the caller has to wrap separately.
    render: async ({ model, nodeTypes, config }) =>
      input.render(parse(config), { model, nodeTypes, config }),
  }

  return Object.freeze(plugin)
}
