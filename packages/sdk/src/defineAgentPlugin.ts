import type { AgentBinding, AgentPlugin } from '@braidhq/core'
import type {
  AgentBindingDescriptor,
  AgentKind,
  PluginId,
} from '@braidhq/schema'
import type { PluginSkillRef } from './types.js'
import { z } from 'zod'
import { assertNonEmpty } from './validation.js'

export interface DefineAgentPluginInput {
  readonly kind: string
  /**
   * Optional Zod schema for the binding descriptor's `config` block.
   * Defaults to a permissive object,
   * so an author need not wire one just to satisfy `Plugin.configSchema`.
   */
  readonly configSchema?: z.ZodTypeAny
  /** Required. Construct a runtime binding from a workspace descriptor. */
  readonly createBinding: (descriptor: AgentBindingDescriptor) => AgentBinding
  /** Skills this plugin ships (e.g. a binding-tuning walkthrough). */
  readonly skills?: readonly PluginSkillRef[]
  /** Optional explicit plugin id, defaults to `agent.<kind>`. */
  readonly pluginId?: string
}

/**
 * Build an AgentPlugin from a declarative spec.
 *
 * Unlike storage and source-loader, the binding is constructed synchronously,
 * because the subprocess spawn happens lazily inside the returned `AgentBinding`.
 *
 * The builder still validates `kind`,
 * and supplies a permissive default `configSchema`,
 * so the registry can serialise the plugin,
 * without the author wiring an empty object themselves.
 */
export function defineAgentPlugin(input: DefineAgentPluginInput): AgentPlugin {
  assertNonEmpty('agent kind', input.kind)

  const configSchema = input.configSchema ?? z.object({}).passthrough()

  const plugin: AgentPlugin & { readonly skills: readonly PluginSkillRef[] } = {
    id: (input.pluginId ?? `agent.${input.kind}`) as PluginId,
    type: 'agent' as const,
    kind: input.kind as AgentKind,
    configSchema,
    skills: input.skills ?? [],
    createBinding: input.createBinding,
  }

  return Object.freeze(plugin)
}
