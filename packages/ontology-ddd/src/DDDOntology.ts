import type { EdgeTypeId, NodeTypeId } from '@braidhq/schema'
import { defineOntology } from '@braidhq/sdk'

/**
 * Default DDD ontology. Edits to the arrays here flow automatically to
 * Studio (palette, legend, filter), the StructuralValidator (topology
 * + cardinality), the OntologyTypeValidator (allow-list), and the
 * `GET /workspaces/:ws/ontology` API response.
 *
 * The framework discovers types via the descriptor arrays alone, so
 * adding a node type (e.g. `policy`) is a one-line change.
 */
export const dddOntology = defineOntology({
  ontologyId: 'ddd',

  nodeTypes: [
    {
      id: 'boundedContext' as NodeTypeId,
      label: 'Bounded Context',
      description: 'A subsystem with its own ubiquitous language; everything inside is one consistency boundary.',
      color: 'oklch(0.62 0.18 274)',
      defaultVisible: true,
    },
    {
      id: 'aggregate' as NodeTypeId,
      label: 'Aggregate',
      description: 'Cluster of domain objects treated as a unit for data changes. Has a single root entity.',
      color: 'oklch(0.7 0.15 155)',
      defaultVisible: true,
    },
    {
      id: 'command' as NodeTypeId,
      label: 'Command',
      description: 'Imperative request that asks the system to change state. Names use verbs (placeOrder, voidTask).',
      color: 'oklch(0.65 0.18 250)',
    },
    {
      id: 'query' as NodeTypeId,
      label: 'Query',
      description: 'Read-only request that returns state without modifying it.',
      color: 'oklch(0.7 0.13 220)',
    },
    {
      id: 'event' as NodeTypeId,
      label: 'Domain Event',
      description: 'Past-tense fact about something that has already happened (OrderPlaced, ItemAdded).',
      color: 'oklch(0.78 0.16 80)',
    },
    {
      id: 'rule' as NodeTypeId,
      label: 'Business Rule',
      description: 'Invariant that must hold (MaxItemsRule, PositiveQuantityRule).',
      color: 'oklch(0.65 0.2 20)',
    },
    {
      id: 'actor' as NodeTypeId,
      label: 'Actor',
      description: 'External role that interacts with the system (Customer, Admin, BillingService).',
      color: 'oklch(0.72 0.13 310)',
    },
  ],

  edgeTypes: [
    {
      id: 'contains' as EdgeTypeId,
      label: 'contains',
      fromTypes: ['boundedContext' as NodeTypeId],
      toTypes: ['aggregate', 'command', 'query', 'event', 'rule'] as NodeTypeId[],
      cardinality: '1:N',
      color: 'oklch(0.62 0.18 274)',
    },
    {
      id: 'accepts' as EdgeTypeId,
      label: 'accepts',
      fromTypes: ['aggregate' as NodeTypeId],
      toTypes: ['command' as NodeTypeId],
      cardinality: '1:N',
      color: 'oklch(0.7 0.15 155)',
    },
    {
      id: 'emits' as EdgeTypeId,
      label: 'emits',
      fromTypes: ['command', 'aggregate'] as NodeTypeId[],
      toTypes: ['event' as NodeTypeId],
      cardinality: '1:N',
      color: 'oklch(0.78 0.16 80)',
    },
    {
      id: 'triggers' as EdgeTypeId,
      label: 'triggers',
      fromTypes: ['event' as NodeTypeId],
      toTypes: ['command' as NodeTypeId],
      cardinality: '1:N',
      color: 'oklch(0.65 0.18 250)',
    },
    {
      id: 'constrainedBy' as EdgeTypeId,
      label: 'constrained by',
      fromTypes: ['command', 'aggregate'] as NodeTypeId[],
      toTypes: ['rule' as NodeTypeId],
      cardinality: 'N:N',
      color: 'oklch(0.65 0.2 20)',
    },
    {
      id: 'dependsOn' as EdgeTypeId,
      label: 'depends on',
      fromTypes: ['boundedContext', 'aggregate', 'command', 'query'] as NodeTypeId[],
      toTypes: ['boundedContext', 'aggregate', 'command', 'query'] as NodeTypeId[],
      cardinality: 'N:N',
      color: 'oklch(0.7 0.13 220)',
    },
    {
      id: 'performedBy' as EdgeTypeId,
      label: 'performed by',
      fromTypes: ['command', 'query'] as NodeTypeId[],
      toTypes: ['actor' as NodeTypeId],
      cardinality: 'N:N',
      color: 'oklch(0.72 0.13 310)',
    },
  ],
})
