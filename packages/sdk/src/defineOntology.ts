import type {
  EdgeTypeDescriptor,
  NodeTypeDescriptor,
  Ontology,
} from '@braidhq/core'
import type {
  EdgeTypeId,
  NodeTypeId,
  OntologyId,
  PluginId,
} from '@braidhq/schema'
import type { PluginSkillRef } from './types.js'
import { z } from 'zod'
import {
  assertColorString,
  assertEndpointsResolve,
  assertNoDuplicateIds,
  assertNonEmpty,
} from './validation.js'

export interface DefineOntologyInput {
  readonly ontologyId: string
  /** Optional base ontology to extend. Node and edge types compose by concatenation; duplicates throw. */
  readonly extends?: Ontology
  /** Node types this ontology contributes. Required `id`, `label`, `description`. */
  readonly nodeTypes: readonly NodeTypeDescriptor[]
  /** Edge types this ontology contributes. Endpoints must resolve in the combined node-type set. */
  readonly edgeTypes: readonly EdgeTypeDescriptor[]
  /** Skills this plugin ships alongside the ontology (see PluginSkillRef). */
  readonly skills?: readonly PluginSkillRef[]
  /** Optional config-schema override; defaults to an empty object schema. */
  readonly configSchema?: z.ZodTypeAny
  /** Optional explicit plugin id; defaults to `ontology.<ontologyId>`. */
  readonly pluginId?: string
}

/**
 * Build a fully-validated Ontology plugin from a declarative spec.
 *
 * Composes with another ontology via `extends`: node and edge types
 * concatenate, duplicates are an error so an extension can't silently
 * mask a base type. The result is a frozen `Ontology` instance that
 * works anywhere the Plugin interface is consumed.
 *
 * Validation is builder-time, not runtime: bad input throws before the
 * plugin ever reaches the PluginRegistry, so the offending line in the
 * plugin's own source code is in the stack trace.
 */
export function defineOntology(input: DefineOntologyInput): Ontology {
  assertNonEmpty('ontologyId', input.ontologyId)

  const baseNodes = input.extends?.nodeTypes ?? []
  const baseEdges = input.extends?.edgeTypes ?? []

  const nodeTypes: readonly NodeTypeDescriptor[] = [...baseNodes, ...input.nodeTypes]
  const edgeTypes: readonly EdgeTypeDescriptor[] = [...baseEdges, ...input.edgeTypes]

  assertNoDuplicateIds(`ontology "${input.ontologyId}" nodeTypes`, nodeTypes.map(n => n.id))
  assertNoDuplicateIds(`ontology "${input.ontologyId}" edgeTypes`, edgeTypes.map(e => e.id))

  for (const node of input.nodeTypes) {
    assertNonEmpty(`node type "${node.id}" description`, node.description)
    if (node.color)
      assertColorString(`node type "${node.id}" color`, node.color)
  }

  const knownNodeIds = new Set(nodeTypes.map(n => n.id))
  for (const edge of input.edgeTypes) {
    const label = `edge type "${edge.id}"`
    assertEndpointsResolve(`${label}.fromTypes`, edge.fromTypes, knownNodeIds)
    assertEndpointsResolve(`${label}.toTypes`, edge.toTypes, knownNodeIds)
    if (edge.color)
      assertColorString(`${label} color`, edge.color)
  }

  return Object.freeze({
    id: (input.pluginId ?? `ontology.${input.ontologyId}`) as PluginId,
    type: 'ontology' as const,
    configSchema: input.configSchema ?? z.object({}),
    ontologyId: input.ontologyId as OntologyId,
    nodeTypes: nodeTypes as readonly NodeTypeDescriptor[] & { readonly [Symbol.iterator]: () => Iterator<NodeTypeDescriptor> },
    edgeTypes: edgeTypes as readonly EdgeTypeDescriptor[] & { readonly [Symbol.iterator]: () => Iterator<EdgeTypeDescriptor> },
    skills: input.skills ?? [],
  }) as Ontology & { readonly skills: readonly PluginSkillRef[] }
}

// Re-export branded id helpers so plugin authors can cast without importing schema directly.
export type { EdgeTypeId, NodeTypeId, OntologyId }
