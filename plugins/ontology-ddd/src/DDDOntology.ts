import type {
  EdgeTypeDescriptor,
  NodeTypeDescriptor,
  Ontology,
} from '@telos/core'
import type {
  EdgeTypeId,
  NodeTypeId,
  OntologyId,
  PluginId,
} from '@telos/schema'
import { z } from 'zod'

/**
 * DDD ontology. The `nodeTypes` / `edgeTypes` arrays here are the canonical
 * source of truth: validators, the `GET /ontology` endpoint, and the
 * extracted-by-skill ontology docs all read from this list. Adding a new
 * node type means editing this one file.
 */
export class DDDOntology implements Ontology {
  readonly id = 'ontology.ddd' as PluginId
  readonly type = 'ontology' as const
  readonly configSchema = z.object({})
  readonly ontologyId = 'ddd' as OntologyId

  readonly nodeTypes: readonly NodeTypeDescriptor[] = [
    {
      id: 'boundedContext' as NodeTypeId,
      label: 'Bounded Context',
      description: 'A subsystem with its own ubiquitous language; everything inside is one consistency boundary.',
      color: 'oklch(0.62 0.18 274)', // purple, primary container type
      defaultVisible: true,
    },
    {
      id: 'aggregate' as NodeTypeId,
      label: 'Aggregate',
      description: 'Cluster of domain objects treated as a unit for data changes. Has a single root entity.',
      color: 'oklch(0.7 0.15 155)', // emerald
      defaultVisible: true,
    },
    {
      id: 'command' as NodeTypeId,
      label: 'Command',
      description: 'Imperative request that asks the system to change state. Names use verbs (placeOrder, voidTask).',
      color: 'oklch(0.65 0.18 250)', // blue
    },
    {
      id: 'query' as NodeTypeId,
      label: 'Query',
      description: 'Read-only request that returns state without modifying it.',
      color: 'oklch(0.7 0.13 220)', // cyan
    },
    {
      id: 'event' as NodeTypeId,
      label: 'Domain Event',
      description: 'Past-tense fact about something that has already happened (OrderPlaced, ItemAdded).',
      color: 'oklch(0.78 0.16 80)', // amber
    },
    {
      id: 'rule' as NodeTypeId,
      label: 'Business Rule',
      description: 'Invariant that must hold (MaxItemsRule, PositiveQuantityRule).',
      color: 'oklch(0.65 0.2 20)', // rose
    },
  ]

  readonly edgeTypes: readonly EdgeTypeDescriptor[] = [
    {
      id: 'contains' as EdgeTypeId,
      label: 'contains',
      fromTypes: ['boundedContext' as NodeTypeId],
      toTypes: ['aggregate', 'command', 'query', 'event', 'rule'] as NodeTypeId[],
      cardinality: '1:N',
      color: 'oklch(0.62 0.18 274)', // purple, matches source boundedContext
    },
    {
      id: 'accepts' as EdgeTypeId,
      label: 'accepts',
      fromTypes: ['aggregate' as NodeTypeId],
      toTypes: ['command' as NodeTypeId],
      cardinality: '1:N',
      color: 'oklch(0.7 0.15 155)', // emerald, matches source aggregate
    },
    {
      id: 'emits' as EdgeTypeId,
      label: 'emits',
      fromTypes: ['command', 'aggregate'] as NodeTypeId[],
      toTypes: ['event' as NodeTypeId],
      cardinality: '1:N',
      color: 'oklch(0.78 0.16 80)', // amber, matches target event
    },
    {
      id: 'triggers' as EdgeTypeId,
      label: 'triggers',
      fromTypes: ['event' as NodeTypeId],
      toTypes: ['command' as NodeTypeId],
      cardinality: '1:N',
      color: 'oklch(0.65 0.18 250)', // blue, matches target command
    },
    {
      id: 'constrainedBy' as EdgeTypeId,
      label: 'constrained by',
      fromTypes: ['command', 'aggregate'] as NodeTypeId[],
      toTypes: ['rule' as NodeTypeId],
      cardinality: 'N:N',
      color: 'oklch(0.65 0.2 20)', // rose, matches target rule
    },
    {
      id: 'dependsOn' as EdgeTypeId,
      label: 'depends on',
      fromTypes: ['boundedContext', 'aggregate', 'command', 'query'] as NodeTypeId[],
      toTypes: ['boundedContext', 'aggregate', 'command', 'query'] as NodeTypeId[],
      cardinality: 'N:N',
      color: 'oklch(0.7 0.13 220)', // cyan
    },
  ]
}
