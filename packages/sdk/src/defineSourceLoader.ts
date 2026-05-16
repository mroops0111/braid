import type {
  IngestReport,
  SourceLoader,
  SourceLoaderContext,
  SyncReport,
} from '@braidhq/core'
import type { AbsolutePath, LoaderKind, PluginId } from '@braidhq/schema'
import type { z } from 'zod'
import type { PluginSkillRef } from './types.js'
import { assertNonEmpty } from './validation.js'

export interface DefineSourceLoaderInput<TConfig> {
  readonly kind: string
  /** Zod schema for the loader's per-source config; parsed before `ingest` / `sync` run. */
  readonly configSchema: z.ZodType<TConfig>
  /** Required. Fill `destination` with content drawn from somewhere external. */
  readonly ingest: (config: TConfig, destination: AbsolutePath, context: SourceLoaderContext) => Promise<IngestReport>
  /** Optional. Refresh `destination` in place. Loaders that can't refresh may omit this. */
  readonly sync?: (config: TConfig, destination: AbsolutePath, context: SourceLoaderContext) => Promise<SyncReport>
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
 * Loaders are responsible for honouring the destination boundary:
 * write only inside the path you were handed.
 */
export function defineSourceLoader<TConfig>(input: DefineSourceLoaderInput<TConfig>): SourceLoader {
  assertNonEmpty('source-loader kind', input.kind)

  const parse = (raw: unknown): TConfig => input.configSchema.parse(raw)

  const loader: SourceLoader & { readonly skills: readonly PluginSkillRef[] } = {
    id: (input.pluginId ?? `source-loader.${input.kind}`) as PluginId,
    type: 'source-loader' as const,
    kind: input.kind as LoaderKind,
    configSchema: input.configSchema,
    skills: input.skills ?? [],
    ingest: (rawConfig, destination, context) => input.ingest(parse(rawConfig), destination, context),
    ...(input.sync
      ? { sync: (rawConfig: unknown, destination: AbsolutePath, context: SourceLoaderContext) => input.sync!(parse(rawConfig), destination, context) }
      : {}),
  }

  return Object.freeze(loader)
}
