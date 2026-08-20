import type {
  ProvisionReport,
  SourceLoaderContext,
  SourceLoaderPlugin,
  SourceUpstream,
  SyncReport,
  WebhookCapability,
  WebhookDelivery,
} from '@braidhq/core'
import type { AbsolutePath, LoaderKind, PluginId } from '@braidhq/schema'
import type { z } from 'zod'
import type { PluginSkillRef } from './types.js'
import { assertNonEmpty } from './validation.js'

export interface DefineSourceLoaderInput<TSchema extends z.ZodTypeAny> {
  readonly kind: string
  /** Zod schema for the loader's per-source config, parsed before `provision` and `sync` run. */
  readonly configSchema: TSchema
  /** Required. Fill `destination` with content drawn from somewhere external. */
  readonly provision: (config: z.infer<TSchema>, destination: AbsolutePath, context: SourceLoaderContext) => Promise<ProvisionReport>
  /** Optional. Refresh `destination` in place. Loaders that can't refresh may omit this. */
  readonly sync?: (config: z.infer<TSchema>, destination: AbsolutePath, context: SourceLoaderContext) => Promise<SyncReport>
  /**
   * Optional. Declare that this loader's sources can be refreshed by a push.
   * `upstream` reports where the content lives, host and path, so a delivery
   * can be matched to a source. `shouldDispatch` decides whether a given event
   * changes this loader's content at all. Neither names a platform.
   * Loaders that omit this field cannot serve webhooks, the receiver 400s.
   */
  readonly webhook?: {
    readonly upstream: (config: z.infer<TSchema>) => SourceUpstream | undefined
    readonly shouldDispatch?: (config: z.infer<TSchema>, delivery: WebhookDelivery) => boolean
  }
  /** Skills this plugin ships (e.g. a migration walkthrough). */
  readonly skills?: readonly PluginSkillRef[]
  /** Optional explicit plugin id, defaults to `source-loader.<kind>`. */
  readonly pluginId?: string
}

/**
 * Build a SourceLoader plugin from a declarative spec.
 *
 * The wrapper validates the config against `configSchema`
 * before each call to `provision` and `sync`,
 * so the loader body always receives a statically-typed config object,
 * without having to parse it itself.
 *
 * `TSchema` is inferred from the declared schema,
 * so the callback's `config` is `z.infer<TSchema>`,
 * and a Zod default or transform surfaces as its post-parse shape.
 * For example `z.boolean().default(true)` reaches the callback as `boolean`,
 * not `boolean | undefined`.
 *
 * Loaders must honour the destination boundary,
 * writing only inside the path they were handed.
 */
export function defineSourceLoaderPlugin<TSchema extends z.ZodTypeAny>(
  input: DefineSourceLoaderInput<TSchema>,
): SourceLoaderPlugin {
  assertNonEmpty('source-loader kind', input.kind)

  const parse = (raw: unknown): z.infer<TSchema> => input.configSchema.parse(raw) as z.infer<TSchema>

  const webhook: WebhookCapability | undefined = input.webhook
    ? {
        upstream: rawConfig => input.webhook!.upstream(parse(rawConfig)),
        ...(input.webhook.shouldDispatch
          ? { shouldDispatch: (rawConfig: unknown, delivery: WebhookDelivery) => input.webhook!.shouldDispatch!(parse(rawConfig), delivery) }
          : {}),
      }
    : undefined

  const loader: SourceLoaderPlugin & { readonly skills: readonly PluginSkillRef[] } = {
    id: (input.pluginId ?? `source-loader.${input.kind}`) as PluginId,
    type: 'source-loader' as const,
    kind: input.kind as LoaderKind,
    configSchema: input.configSchema,
    skills: input.skills ?? [],
    // `async` so that a parse error surfaces as a rejected promise,
    // not a synchronous throw the caller has to wrap separately.
    provision: async (rawConfig, destination, context) => input.provision(parse(rawConfig), destination, context),
    ...(input.sync
      ? { sync: async (rawConfig: unknown, destination: AbsolutePath, context: SourceLoaderContext) => input.sync!(parse(rawConfig), destination, context) }
      : {}),
    ...(webhook ? { webhook } : {}),
  }

  return Object.freeze(loader)
}
