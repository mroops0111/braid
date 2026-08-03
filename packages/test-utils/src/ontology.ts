import type {
  EdgeTypeDescriptor,
  NodeTypeDescriptor,
  OntologyBatchBinding,
  OntologyPlugin,
  OntologyValidator,
  SourceRoleDescriptor,
} from '@braidhq/core'
import type { OntologyId, PluginId } from '@braidhq/schema'
import { SourceRole } from '@braidhq/schema'
import { z } from 'zod'

/** Loose source-role input for tests. `id` is branded and `label` defaults to `id`. */
export interface SourceRoleInput {
  readonly id: string
  readonly label?: string
  readonly required?: boolean
  readonly unitBearing?: boolean
  readonly pathSegment?: string
}

export interface MakeOntologyOptions {
  readonly ontologyId?: string
  readonly pluginId?: string
  readonly nodeTypes?: readonly NodeTypeDescriptor[]
  readonly edgeTypes?: readonly EdgeTypeDescriptor[]
  readonly validators?: readonly OntologyValidator[]
  readonly batch?: OntologyBatchBinding
  readonly sourceRoles?: readonly SourceRoleInput[]
}

function toRoleDescriptor(role: SourceRoleInput): SourceRoleDescriptor {
  return {
    id: SourceRole.parse(role.id),
    label: role.label ?? role.id,
    ...(role.required !== undefined ? { required: role.required } : {}),
    ...(role.unitBearing !== undefined ? { unitBearing: role.unitBearing } : {}),
    ...(role.pathSegment !== undefined ? { pathSegment: role.pathSegment } : {}),
  }
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
    sourceRoles: (opts.sourceRoles ?? []).map(toRoleDescriptor),
    ...(opts.batch ? { batch: opts.batch } : {}),
  }
}
