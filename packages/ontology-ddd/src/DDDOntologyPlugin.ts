import { EdgeTypeId, NodeTypeId, SkillId } from '@braidhq/schema'
import { defineOntologyPlugin } from '@braidhq/sdk'

/**
 * The default DDD ontology, consolidating Strategic DDD (Evans),
 * Tactical DDD (Vernon), EventStorming (Brandolini), and CQRS (Young),
 * as framed by Khononov's Learning Domain-Driven Design (2021).
 * Every node and edge description tags its sub-domain and cites its source,
 * so an LLM or reviewer knows which tradition each element comes from.
 * Editing a type here flows through the ontology contract to Studio,
 * the structural and ontology-type validators, and the ontology API,
 * with no change needed on those sides.
 */
export const dddOntology = defineOntologyPlugin({
  ontologyId: 'ddd',

  // DDD models a domain through intent and code convergence.
  // Extracting from intent alone ships speculation into the graph,
  // and from code alone drags implementation accidents into the language.
  // Both roles are required, so a workspace cannot start in a state where
  // this value prop fails. Intent docs are the unit-bearing role, each doc
  // is one extraction unit and its sync drives the Reactor. Code is context
  // the per-unit skill reads, and seeds derived mode when no intent exists.
  sourceRoles: [
    { id: 'intent', label: 'Intent', required: true, unitBearing: true, pathSegment: 'intents' },
    { id: 'code', label: 'Code', required: true, pathSegment: 'codebases' },
  ],

  // SKILL.md prompts shipped with this ontology.
  // They encode DDD-specific reasoning, like the Context Mapping edges,
  // that a non-DDD ontology should not inherit,
  // so they live here rather than in @braidhq/core.
  // The id is composed as `ddd:<directory basename>`, ddd from ontologyId,
  // so the namespace is never repeated or forgotten here.
  skills: [
    { directory: new URL('../skills/extract', import.meta.url) },
    { directory: new URL('../skills/clarify', import.meta.url) },
    { directory: new URL('../skills/reconcile', import.meta.url) },
  ],

  // Shared reference docs every SKILL.md above consults,
  // so the DDD vocabulary, wiring rules, and id conventions live in one place,
  // not duplicated per prompt.
  referenceDirs: [
    {
      name: 'ontology-ddd',
      directory: new URL('../skills/shared', import.meta.url),
    },
  ],

  nodeTypes: [
    {
      id: NodeTypeId.parse('boundedContext'),
      label: 'Bounded Context',
      description: 'A subsystem with its own ubiquitous language; everything inside is one consistency boundary. Strategic DDD primitive (Evans Blue Book Part IV; Khononov 2021 ch. 3).',
      color: 'oklch(0.7 0.035 260)',
      defaultVisible: true,
      renderHint: { container: true, section: 'Use cases' },
    },
    {
      id: NodeTypeId.parse('aggregate'),
      label: 'Aggregate',
      description: 'Cluster of domain objects treated as a unit for data changes; has a single root entity that controls access. Tactical DDD primitive (Evans Blue Book Part II; Vernon IDDD ch. 10; Khononov 2021 ch. 6).',
      color: 'oklch(0.7 0.12 155)',
      defaultVisible: true,
      renderHint: { expandedUnder: NodeTypeId.parse('boundedContext') },
    },
    {
      id: NodeTypeId.parse('command'),
      label: 'Command',
      description: 'Imperative request that asks the system to change state; names use verbs (placeOrder, cancelOrder). CQRS primitive (Young 2010; Khononov 2021 ch. 11). The blue sticky in EventStorming.',
      color: 'oklch(0.65 0.14 250)',
      renderHint: { expandedUnder: NodeTypeId.parse('aggregate') },
    },
    {
      id: NodeTypeId.parse('query'),
      label: 'Query',
      description: 'Read-only request that returns state without modifying it. CQRS primitive (Young 2010; Khononov 2021 ch. 11). Strict CQRS routes queries to a dedicated read-model node; in the absence of that node type, queries attach to the aggregate.',
      color: 'oklch(0.7 0.11 220)',
      renderHint: { expandedUnder: NodeTypeId.parse('aggregate') },
    },
    {
      id: NodeTypeId.parse('event'),
      label: 'Domain Event',
      description: 'Past-tense fact about something that has already happened (OrderPlaced, ItemAdded). Tactical DDD primitive (Vernon IDDD ch. 8) and the orange sticky in EventStorming.',
      color: 'oklch(0.76 0.13 80)',
      renderHint: { expandedUnder: NodeTypeId.parse('command') },
    },
    {
      id: NodeTypeId.parse('rule'),
      label: 'Business Rule',
      description: 'Invariant that must hold (MaxItemsRule, PositiveQuantityRule). Tactical DDD (Evans Specification pattern; Vernon IDDD invariants). Per-operation rules attach to a command or query; aggregate-wide invariants attach to the aggregate itself.',
      color: 'oklch(0.65 0.15 20)',
      renderHint: { expandedUnder: NodeTypeId.parse('command') },
    },
    {
      id: NodeTypeId.parse('actor'),
      label: 'Actor',
      description: 'External role that triggers a command or query (Customer, Admin, BillingService). EventStorming primitive (Brandolini; the yellow stick-figure sticky) and Khononov 2021. Not in strict Evans / Vernon canon, where the issuer lives on the command\'s metadata.',
      color: 'oklch(0.72 0.11 310)',
      renderHint: { section: 'Actors' },
    },
    {
      id: NodeTypeId.parse('policy'),
      label: 'Policy',
      description: 'Automatic reaction: "when event X happens, do Y". EventStorming primitive (Brandolini; the purple sticky) and Khononov 2021. Materialises Vernon\'s Process Manager / Saga pattern when the reaction crosses aggregates or has its own naming.',
      color: 'oklch(0.62 0.15 310)',
      renderHint: { section: 'Reactions' },
    },
  ],

  edgeTypes: [
    {
      id: EdgeTypeId.parse('contains'),
      label: 'contains',
      description: 'A BoundedContext contains aggregates. Commands, queries, events, and rules belong to an aggregate and are reached via accepts, emits, or constrainedBy. Strategic DDD (Evans Blue Book Part IV).',
      fromTypes: [NodeTypeId.parse('boundedContext')],
      toTypes: [NodeTypeId.parse('aggregate')],
      cardinality: '1:N',
      color: 'oklch(0.7 0.035 260)',
    },
    {
      id: EdgeTypeId.parse('accepts'),
      label: 'accepts',
      description: 'Aggregate is the entry point for operations against its state; commands modify the aggregate and queries read it. Tactical DDD with CQRS (Khononov 2021 ch. 11). Strict CQRS would route queries to a dedicated read-model node; this ontology routes both through the aggregate.',
      fromTypes: [NodeTypeId.parse('aggregate')],
      toTypes: [NodeTypeId.parse('command'), NodeTypeId.parse('query')],
      cardinality: '1:N',
      color: 'oklch(0.7 0.12 155)',
    },
    {
      id: EdgeTypeId.parse('emits'),
      label: 'emits',
      description: 'A command produces an event as the result of executing on its aggregate. Either source is valid in this ontology: command-source (CQRS / EventStorming visual reading: cmd to evt) and aggregate-source (Vernon IDDD structural reading: agg to evt). Khononov 2021 illustrates both; prefer the command-source form when extracting from PRD/spec language and the aggregate-source form when describing state ownership.',
      fromTypes: [NodeTypeId.parse('command'), NodeTypeId.parse('aggregate')],
      toTypes: [NodeTypeId.parse('event')],
      cardinality: '1:N',
      color: 'oklch(0.76 0.13 80)',
    },
    {
      id: EdgeTypeId.parse('triggers'),
      label: 'triggers',
      description: 'Process-manager / saga flow: an event drives a downstream command or policy, often in a different aggregate. EventStorming flow notation (Brandolini); CQRS saga pattern (Khononov 2021 ch. 11).',
      fromTypes: [NodeTypeId.parse('event')],
      toTypes: [NodeTypeId.parse('command'), NodeTypeId.parse('policy')],
      cardinality: 'N:N',
      color: 'oklch(0.65 0.14 250)',
    },
    {
      id: EdgeTypeId.parse('enacts'),
      label: 'enacts',
      description: 'A policy issues a command as its reaction. The "do Y" half of EventStorming\'s "when X then Y" / Vernon\'s Process Manager (Brandolini; Vernon IDDD ch. 13; Khononov 2021).',
      fromTypes: [NodeTypeId.parse('policy')],
      toTypes: [NodeTypeId.parse('command')],
      cardinality: 'N:N',
      color: 'oklch(0.62 0.15 310)',
    },
    {
      id: EdgeTypeId.parse('constrainedBy'),
      label: 'constrained by',
      description: 'Per-operation rule: a command or query is constrained by a specific rule. Aggregate-wide invariant: an aggregate is constrained by a rule that must hold across all of its operations. Tactical DDD (Evans Specification pattern; Vernon IDDD invariants).',
      fromTypes: [NodeTypeId.parse('command'), NodeTypeId.parse('query'), NodeTypeId.parse('aggregate')],
      toTypes: [NodeTypeId.parse('rule')],
      cardinality: 'N:N',
      color: 'oklch(0.65 0.15 20)',
    },
    {
      id: EdgeTypeId.parse('dependsOn'),
      label: 'depends on',
      description: 'Aggregates reference other aggregates by id only. Tactical DDD (Vernon IDDD "Reference Other Aggregates by Identity" rule; Khononov 2021 ch. 6). Cross-aggregate command or query coupling is expressed through triggers rather than direct references.',
      fromTypes: [NodeTypeId.parse('aggregate')],
      toTypes: [NodeTypeId.parse('aggregate')],
      cardinality: 'N:N',
      color: 'oklch(0.7 0.11 220)',
    },
    {
      id: EdgeTypeId.parse('performedBy'),
      label: 'performed by',
      description: 'A command or query is triggered by an actor. EventStorming convention (Brandolini) and Khononov 2021. Not in strict Evans / Vernon canon, where the issuer lives on the command\'s metadata rather than as a graph edge.',
      fromTypes: [NodeTypeId.parse('command'), NodeTypeId.parse('query')],
      toTypes: [NodeTypeId.parse('actor')],
      cardinality: 'N:N',
      color: 'oklch(0.72 0.11 310)',
    },

    // Context Mapping, Strategic DDD from Evans Blue Book Part IV.
    // Every edge runs BoundedContext to BoundedContext,
    // each pattern with its own direction and cardinality.
    // These are strategic relationships between teams and integrations,
    // not derivable from individual feature slices.
    {
      id: EdgeTypeId.parse('partnership'),
      label: 'partnership',
      description: 'Symmetric: two BoundedContexts are committed to succeed or fail together; coordinated planning and joint releases. Strategic DDD Context Mapping (Evans Blue Book Part IV; Khononov 2021 ch. 4).',
      fromTypes: [NodeTypeId.parse('boundedContext')],
      toTypes: [NodeTypeId.parse('boundedContext')],
      cardinality: 'N:N',
      color: 'oklch(0.6 0.15 240)',
    },
    {
      id: EdgeTypeId.parse('customerSupplier'),
      label: 'customer-supplier',
      description: 'Asymmetric (customer downstream, supplier upstream): the customer BoundedContext depends on the supplier and has political pull to ask for changes. Strategic DDD Context Mapping (Evans Blue Book Part IV; Khononov 2021 ch. 4).',
      fromTypes: [NodeTypeId.parse('boundedContext')],
      toTypes: [NodeTypeId.parse('boundedContext')],
      cardinality: 'N:1',
      color: 'oklch(0.65 0.18 200)',
    },
    {
      id: EdgeTypeId.parse('conformist'),
      label: 'conformist',
      description: 'Asymmetric (conformist downstream, upstream uncooperative): the downstream BoundedContext depends on an upstream it has no political pull over and adopts the upstream\'s model as-is. Strategic DDD Context Mapping (Evans Blue Book Part IV; Khononov 2021 ch. 4).',
      fromTypes: [NodeTypeId.parse('boundedContext')],
      toTypes: [NodeTypeId.parse('boundedContext')],
      cardinality: 'N:1',
      color: 'oklch(0.55 0.13 50)',
    },
    {
      id: EdgeTypeId.parse('sharedKernel'),
      label: 'shared kernel',
      description: 'Symmetric: two BoundedContexts intentionally share a small piece of model (often a value object). Any change to the shared part requires coordination between both teams. Strategic DDD Context Mapping (Evans Blue Book Part IV; Khononov 2021 ch. 4).',
      fromTypes: [NodeTypeId.parse('boundedContext')],
      toTypes: [NodeTypeId.parse('boundedContext')],
      cardinality: 'N:N',
      color: 'oklch(0.6 0.13 160)',
    },
    {
      id: EdgeTypeId.parse('anticorruptionLayer'),
      label: 'anticorruption layer',
      description: 'Asymmetric (acl-owner downstream, upstream isolated from): the downstream BoundedContext isolates itself from the upstream by building a translation layer so its internal model is not corrupted by the upstream\'s shape. Strategic DDD Context Mapping (Evans Blue Book Part IV; Khononov 2021 ch. 4).',
      fromTypes: [NodeTypeId.parse('boundedContext')],
      toTypes: [NodeTypeId.parse('boundedContext')],
      cardinality: 'N:N',
      color: 'oklch(0.55 0.18 30)',
    },
    {
      id: EdgeTypeId.parse('openHostService'),
      label: 'open host service',
      description: 'Asymmetric (host upstream, consumer downstream): the upstream BoundedContext offers a well-defined open protocol any downstream can consume without bespoke negotiation. Strategic DDD Context Mapping (Evans Blue Book Part IV; Khononov 2021 ch. 4).',
      fromTypes: [NodeTypeId.parse('boundedContext')],
      toTypes: [NodeTypeId.parse('boundedContext')],
      cardinality: '1:N',
      color: 'oklch(0.65 0.15 130)',
    },
    {
      id: EdgeTypeId.parse('publishedLanguage'),
      label: 'published language',
      description: 'Asymmetric (publisher upstream, consumer downstream): the upstream BoundedContext publishes a documented schema or format; downstreams consume it as-is. Often combined with openHostService. Strategic DDD Context Mapping (Evans Blue Book Part IV; Khononov 2021 ch. 4).',
      fromTypes: [NodeTypeId.parse('boundedContext')],
      toTypes: [NodeTypeId.parse('boundedContext')],
      cardinality: '1:N',
      color: 'oklch(0.7 0.15 100)',
    },
  ],

  // Batch and reactor binding.
  // The per-unit skill is ddd:extract.
  // The checkpoint ddd:reconcile fires every 5 successful extracts,
  // and once more at the end of the loop for global validation.
  // When the workspace has no intent source,
  // braid:scan derives units from the codebase.
  batch: {
    perUnit: {
      skillId: SkillId.parse('ddd:extract'),
      label: 'Extract',
    },
    checkpoint: {
      skillId: SkillId.parse('ddd:reconcile'),
      label: 'Model',
      chunkSize: 5,
      runAtEnd: true,
      extraEnv: (units) => {
        const hint = units
          .filter(u => u.sourceId && u.scopeHint)
          .map(u => `${u.sourceId}::${u.scopeHint}`)
          .join('\n')
        return hint ? { BRAID_CHANGED_UNITS: hint } : {}
      },
    },
    deriveUnits: {
      skillId: SkillId.parse('braid:scan'),
    },
  },
})
