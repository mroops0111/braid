import type { RenderInput, ViewGeneratorPlugin } from '@braidhq/core'
import type { PluginId, ViewArtifact, ViewKind } from '@braidhq/schema'
import type { z } from 'zod'
import type { PluginSkillRef } from './types.js'
import { assertNonEmpty } from './validation.js'

export interface DefineViewGeneratorInput<TSchema extends z.ZodTypeAny> {
  readonly viewKind: string
  /** Zod schema for the per-render config; parsed before `render` runs. */
  readonly configSchema: TSchema
  /** Required. Project a model snapshot into a view artifact. */
  readonly render: (config: z.infer<TSchema>, input: RenderInput) => Promise<ViewArtifact>
  /** Skills this plugin ships (e.g. a template-walkthrough skill). */
  readonly skills?: readonly PluginSkillRef[]
  /** Optional explicit plugin id; defaults to `view-generator.<viewKind>`. */
  readonly pluginId?: string
}

/**
 * Build a ViewGeneratorPlugin from a declarative spec.
 *
 * The wrapper parses `input.config` against `configSchema` before
 * `render` runs, so the plugin body always receives a statically-typed
 * config object. Mirrors the other `defineXxx` builders so plugin
 * authors find a uniform entry point across every axis.
 */
export function defineViewGenerator<TSchema extends z.ZodTypeAny>(
  input: DefineViewGeneratorInput<TSchema>,
): ViewGeneratorPlugin {
  assertNonEmpty('view-generator viewKind', input.viewKind)

  const parse = (raw: unknown): z.infer<TSchema> => input.configSchema.parse(raw) as z.infer<TSchema>

  const plugin: ViewGeneratorPlugin & { readonly skills: readonly PluginSkillRef[] } = {
    id: (input.pluginId ?? `view-generator.${input.viewKind}`) as PluginId,
    type: 'view-generator' as const,
    viewKind: input.viewKind as ViewKind,
    configSchema: input.configSchema,
    skills: input.skills ?? [],
    // `async` so that a parse error surfaces as a rejected promise,
    // not a synchronous throw the caller has to wrap separately.
    render: async ({ model, config }) =>
      input.render(parse(config), { model, config }),
  }

  return Object.freeze(plugin)
}
