import type {
  ModelRepository,
  StoragePlugin,
  StoragePluginContext,
} from '@braidhq/core'
import type { PluginId, StorageDescriptor, StorageKind } from '@braidhq/schema'
import type { z } from 'zod'
import type { PluginSkillRef } from './types.js'
import { assertNonEmpty } from './validation.js'

export interface DefineStoragePluginInput<TSchema extends z.ZodTypeAny> {
  readonly kind: string
  /** Zod schema for the storage descriptor's config, parsed before `createModelRepository` runs. */
  readonly configSchema: TSchema
  /** Required. Construct the per-process repository for this kind. */
  readonly createModelRepository: (
    config: z.infer<TSchema>,
    descriptor: StorageDescriptor,
    context: StoragePluginContext,
  ) => Promise<ModelRepository>
  /** Skills this plugin ships, rare for storage but possible for migration walkthroughs. */
  readonly skills?: readonly PluginSkillRef[]
  /** Optional explicit plugin id, defaults to `storage.<kind>`. */
  readonly pluginId?: string
}

/**
 * Build a StoragePlugin from a declarative spec.
 *
 * The wrapper parses `descriptor.config` against `configSchema`
 * before each call to `createModelRepository`,
 * so the plugin body always receives a statically-typed config object,
 * without having to validate it itself.
 * Mirrors the other `defineXxx` builders,
 * so plugin authors find a uniform entry point across every axis.
 */
export function defineStoragePlugin<TSchema extends z.ZodTypeAny>(
  input: DefineStoragePluginInput<TSchema>,
): StoragePlugin {
  assertNonEmpty('storage kind', input.kind)

  const parse = (raw: unknown): z.infer<TSchema> => input.configSchema.parse(raw) as z.infer<TSchema>

  const plugin: StoragePlugin & { readonly skills: readonly PluginSkillRef[] } = {
    id: (input.pluginId ?? `storage.${input.kind}`) as PluginId,
    type: 'storage' as const,
    kind: input.kind as StorageKind,
    configSchema: input.configSchema,
    skills: input.skills ?? [],
    // `async` so that a parse error surfaces as a rejected promise,
    // not a synchronous throw the caller has to wrap separately.
    createModelRepository: async (descriptor, context) =>
      input.createModelRepository(parse(descriptor.config), descriptor, context),
  }

  return Object.freeze(plugin)
}
