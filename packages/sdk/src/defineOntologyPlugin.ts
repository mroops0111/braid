import type {
  EdgeTypeDescriptor,
  NodeTypeDescriptor,
  OntologyBatchBinding,
  OntologyPlugin,
  OntologyValidator,
} from '@braidhq/core'
import type {
  EdgeTypeId,
  NodeTypeId,
  OntologyId,
  PluginId,
} from '@braidhq/schema'
import type { PluginReferenceDirRef, PluginSkillRef } from './types.js'
import { OntologyTypeValidator, StructuralValidator } from '@braidhq/core'
import { z } from 'zod'
import {
  assertColorString,
  assertEndpointsResolve,
  assertNoDuplicateIds,
  assertNonEmpty,
} from './validation.js'

export interface DefineOntologyInput {
  readonly ontologyId: string
  /** Optional base ontology to extend. Node and edge types concatenate, and duplicates throw. */
  readonly extends?: OntologyPlugin
  /** Node types this ontology contributes. Each needs an `id`, a `label`, and a `description`. */
  readonly nodeTypes: readonly NodeTypeDescriptor[]
  /**
   * Edge types this ontology contributes.
   * Endpoints must resolve in the combined node-type set,
   * and a `description` is required so an LLM or reviewer can tell them apart.
   */
  readonly edgeTypes: readonly EdgeTypeDescriptor[]
  /**
   * Extra validators bundled with this ontology,
   * on top of the framework's OntologyTypeValidator and StructuralValidator,
   * which are auto-attached.
   * Use this for ontology-specific invariants the declarative nodeTypes,
   * edgeTypes, and cardinality cannot express,
   * such as an aggregate that needs at least one command.
   */
  readonly extraValidators?: readonly OntologyValidator[]
  /** Skills this plugin ships alongside the ontology (see PluginSkillRef). */
  readonly skills?: readonly PluginSkillRef[]
  /**
   * Reference directories, such as concept docs or shared rules, this plugin
   * ships for its skills to Read at run time (see PluginReferenceDirRef).
   */
  readonly referenceDirs?: readonly PluginReferenceDirRef[]
  /** Optional config-schema override, defaults to an empty object schema. */
  readonly configSchema?: z.ZodTypeAny
  /** Optional explicit plugin id, defaults to `ontology.<ontologyId>`. */
  readonly pluginId?: string
  /**
   * Optional batch and reactor binding. Declare which skill processes one
   * intent unit, the optional checkpoint configuration, and the optional
   * derive-units skill. Without it the workspace cannot start a batch under
   * this ontology.
   */
  readonly batch?: OntologyBatchBinding
  /**
   * Source roles a workspace must have for this ontology to be usable.
   * The scaffold endpoint validates the manifest against this list and
   * rejects a miss with 422, so the wizard can prompt for the missing roles.
   * DDD declares `['intent', 'code']`,
   * a generative ontology with no code dimension declares `['intent']`.
   */
  readonly requiredSourceRoles?: readonly ('code' | 'intent')[]
}

/**
 * Build a fully-validated OntologyPlugin from a declarative spec.
 *
 * Composes with another ontology via `extends`,
 * so node and edge types concatenate, and a duplicate is an error,
 * so an extension cannot silently mask a base type.
 *
 * Auto-attaches the framework's two generic validation engines,
 * OntologyTypeValidator for the type allow-list,
 * and StructuralValidator for topology and cardinality.
 * Plugin authors do not need to wire them.
 *
 * Validation is builder-time, not runtime,
 * so bad input throws before it reaches the PluginRegistry,
 * and the offending line in the plugin's own source is in the stack trace.
 */
export function defineOntologyPlugin(input: DefineOntologyInput): OntologyPlugin {
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
    assertNonEmpty(`${label} description`, edge.description)
    assertEndpointsResolve(`${label}.fromTypes`, edge.fromTypes, knownNodeIds)
    assertEndpointsResolve(`${label}.toTypes`, edge.toTypes, knownNodeIds)
    if (edge.color)
      assertColorString(`${label} color`, edge.color)
  }

  // We assemble the plugin in two passes.
  // Build the base shape first,
  // so the type and structural validators have something to bind to,
  // then attach the validators array referencing that same instance.
  // The freeze below makes later mutation impossible,
  // but for an ontology that ships its own validators,
  // binding them to the live instance is the standard pattern.
  const ontology: OntologyPlugin = {
    id: (input.pluginId ?? `ontology.${input.ontologyId}`) as PluginId,
    type: 'ontology' as const,
    configSchema: input.configSchema ?? z.object({}),
    ontologyId: input.ontologyId as OntologyId,
    nodeTypes,
    edgeTypes,
    skills: input.skills ?? [],
    // The ontology id is the skill namespace,
    // so its skills invoke as `/<ontologyId>:<verb>`,
    // without the author repeating it per skill.
    skillNamespace: input.ontologyId,
    referenceDirs: input.referenceDirs ?? [],
    validators: [],
    ...(input.batch ? { batch: input.batch } : {}),
    ...(input.requiredSourceRoles ? { requiredSourceRoles: input.requiredSourceRoles } : {}),
  }

  const validators: OntologyValidator[] = [
    new OntologyTypeValidator(ontology),
    new StructuralValidator(ontology),
    ...(input.extraValidators ?? []),
  ]
  ;(ontology as { validators: readonly OntologyValidator[] }).validators = validators

  return Object.freeze(ontology)
}

/** Re-export branded id helpers so plugin authors can cast without importing schema directly. */
export type { EdgeTypeId, NodeTypeId, OntologyId }
