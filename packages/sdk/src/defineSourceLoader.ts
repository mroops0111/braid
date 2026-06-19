import type {
  IngestReport,
  SourceLoaderContext,
  SourceLoaderPlugin,
  SyncReport,
} from '@braidhq/core'
import type { AbsolutePath, LoaderKind, PluginId } from '@braidhq/schema'
import type { z } from 'zod'
import type { PluginSkillRef } from './types.js'
import { assertNonEmpty } from './validation.js'

export interface DefineSourceLoaderInput<TSchema extends z.ZodTypeAny> {
  readonly kind: string
  /** Zod schema for the loader's per-source config; parsed before `ingest` / `sync` run. */
  readonly configSchema: TSchema
  /** Required. Fill `destination` with content drawn from somewhere external. */
  readonly ingest: (config: z.infer<TSchema>, destination: AbsolutePath, context: SourceLoaderContext) => Promise<IngestReport>
  /** Optional. Refresh `destination` in place. Loaders that can't refresh may omit this. */
  readonly sync?: (config: z.infer<TSchema>, destination: AbsolutePath, context: SourceLoaderContext) => Promise<SyncReport>
  /** Skills this plugin ships (e.g. a migration walkthrough). */
  readonly skills?: readonly PluginSkillRef[]
  /** Optional explicit plugin id; defaults to `source-loader.<kind>`. */
  readonly pluginId?: string
}

/**
 * Build a SourceLoader plugin from a declarative spec.
 *
 * The wrapper validates the config against `configSchema` before each
 * call to `ingest` / `sync`, so the loader body always receives a
 * statically-typed config object without having to parse it itself.
 * `TSchema` is inferred from the declared schema; the callback's `config`
 * parameter is `z.infer<TSchema>` so Zod defaults / transforms surface as
 * their post-parse shape (e.g. `z.boolean().default(true)` reaches the
 * callback as `boolean`, not `boolean | undefined`).
 * Loaders are responsible for honouring the destination boundary:
 * write only inside the path you were handed.
 */
export function defineSourceLoader<TSchema extends z.ZodTypeAny>(
  input: DefineSourceLoaderInput<TSchema>,
): SourceLoaderPlugin {
  assertNonEmpty('source-loader kind', input.kind)

  const parse = (raw: unknown): z.infer<TSchema> => input.configSchema.parse(raw) as z.infer<TSchema>

  const loader: SourceLoaderPlugin & { readonly skills: readonly PluginSkillRef[] } = {
    id: (input.pluginId ?? `source-loader.${input.kind}`) as PluginId,
    type: 'source-loader' as const,
    kind: input.kind as LoaderKind,
    configSchema: input.configSchema,
    skills: input.skills ?? [],
    // `async` so that a parse error surfaces as a rejected promise,
    // not a synchronous throw the caller has to wrap separately.
    ingest: async (rawConfig, destination, context) => input.ingest(parse(rawConfig), destination, context),
    ...(input.sync
      ? { sync: async (rawConfig: unknown, destination: AbsolutePath, context: SourceLoaderContext) => input.sync!(parse(rawConfig), destination, context) }
      : {}),
  }

  return Object.freeze(loader)
}
