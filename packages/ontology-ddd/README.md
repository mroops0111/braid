# @braidhq/ontology-ddd

Braid extracts a product's intent and code into one knowledge graph. `@braidhq/ontology-ddd` is the default worldview for that graph, a Domain-Driven Design vocabulary. It defines the node and edge types, ships the skill prompts that populate them, and binds the batch loop that runs extraction.

## Role

The package is an `OntologyPlugin` for DDD. It says what a DDD graph is made of, and supplies the reasoning that fills it.

- **The Vocabulary**: Eight node types (bounded context, aggregate, command, query, event, rule, actor, policy) and fifteen edge types, each tagged with the sub-domain and canonical source it comes from.
- **The Skills**: The `ddd:extract`, `ddd:clarify`, and `ddd:reconcile` SKILL.md prompts, plus the shared reference docs they all consult. Each directory is the bare verb, the `ddd` namespace comes from the ontology.
- **The Binding**: The required source roles, and the batch and reactor loop that drives per-unit extraction with periodic reconcile checkpoints.

## Structure

The package is flat. The ontology and its enums sit under `src/`, the prompts under `skills/`.

```
src/
├── DDDOntologyPlugin.ts   the defineOntologyPlugin value: types, skills, batch binding
├── types.ts               the DDDNodeType and DDDEdgeType enums
└── index.ts
skills/
├── extract/    per-unit extraction prompt
├── clarify/    clarification prompt
├── reconcile/  cross-link the slices and validate the whole graph
└── shared/     reference docs every prompt consults
```

- **DDDOntology**: The single `defineOntologyPlugin` call. Node and edge types with their labels, colors, and render hints, the required source roles, the skills, and the batch binding.
- **types**: The closed `DDDNodeType` and `DDDEdgeType` enums, the type-level mirror of the ids declared in the ontology.
- **skills**: The SKILL.md prompts. DDD-specific reasoning lives here rather than in core, so a different worldview cannot inherit it.

## The Ontology

A DDD graph reads outward from a bounded context: a `contains` edge holds its aggregates, an aggregate `accepts` commands and queries, a command `emits` events, an event `triggers` downstream work, and a policy `enacts` the command that reacts to it. Operations are `constrainedBy` rules and `performedBy` actors. A separate Context Mapping family wires bounded contexts to one another, partnership, conformist, anticorruption layer, and the rest.

Editing a type here flows through the ontology contract to Studio's palette and legend, the structural and ontology-type validators, and the `GET /workspaces/:ws/ontology` API, with no change needed on those sides.

## Boundaries

- **DDD Lives Here**: The vocabulary and its reasoning are confined to this package. Core stays worldview-agnostic, and a generative or narrative ontology is a sibling package.
- **Definition, Not Behavior**: The package is a pure `defineOntologyPlugin` value. It reads no files and runs nothing, the validators and services in core act on it.
- **Single Schema Source**: Node and edge ids are branded through `@braidhq/schema`. The `types.ts` enums mirror those ids, they do not redeclare a shape.
- **Wiring Elsewhere**: The composition root registers the plugin. Nothing here reaches into server or studio.

## Dependencies

- **Depends On**: `@braidhq/schema` for branded ids, `@braidhq/core` for the plugin port, and `@braidhq/sdk` for `defineOntologyPlugin`.
- **Consumed By**: `server`, at its composition root, as the default ontology bundle.
