import type {
  EdgeTypeDescriptor,
  NodeTypeDescriptor,
  OntologyBatchBinding,
  OntologyPlugin,
  OntologyValidator,
} from '@braidhq/core'
import type { OntologyId, PluginId } from '@braidhq/schema'
import { z } from 'zod'

export interface MakeOntologyOptions {
  readonly ontologyId?: string
  readonly pluginId?: string
  readonly nodeTypes?: readonly NodeTypeDescriptor[]
  readonly edgeTypes?: readonly EdgeTypeDescriptor[]
  readonly validators?: readonly OntologyValidator[]
  readonly batch?: OntologyBatchBinding
  readonly requiredSourceRoles?: readonly ('code' | 'intent')[]
}

/**
 * Construct a bare OntologyPlugin for tests.
 * Defaults to an empty ontology with no nodes, edges, or validators.
 * Pass per-test overrides to exercise a specific path.
 * Use this rather than an inline literal,
 * which fails the excess-property check because register() takes Plugin.
 */
export function makeOntology(opts: MakeOntologyOptions = {}): OntologyPlugin {
  const ontologyId = (opts.ontologyId ?? 'ddd') as OntologyId
  return {
    id: (opts.pluginId ?? `ontology.${ontologyId}`) as PluginId,
    type: 'ontology',
    configSchema: z.object({}),
    ontologyId,
    nodeTypes: opts.nodeTypes ?? [],
    edgeTypes: opts.edgeTypes ?? [],
    validators: opts.validators ?? [],
    ...(opts.batch ? { batch: opts.batch } : {}),
    ...(opts.requiredSourceRoles ? { requiredSourceRoles: [...opts.requiredSourceRoles] } : {}),
  }
}
