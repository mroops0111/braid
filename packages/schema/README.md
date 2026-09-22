# @braidhq/schema

Braid keeps a product's intent and its code aligned in one knowledge graph. `@braidhq/schema` is the contract for that graph. Every data shape in Braid is defined here once, as a zod schema paired with its TypeScript type, and every other package imports from here.

## Role

Schema is the root of the monorepo. It says what data looks like, and nothing about what happens to it.

- **The Shapes**: Every entity, message, and config as a zod schema with an inferred type, so validation and typing come from one definition.
- **The Ids**: Branded identifiers, so a `NodeId` can never be passed where a `ProposalId` belongs.
- **The Vocabulary**: The closed enums and open brands that decide which sets are fixed and which are extensible.
- **The Render Calls**: `RenderBlock` and its ten calls. Because this is the one layer the server and Studio both see, a single zod object is the route body, the MCP tool schema, and the renderer's type at once.

## Structure

The package is flat. Every module sits directly under `src/` and re-exports through the `index.ts` barrel.

```
src/
├── common.ts
├── model.ts
├── proposal.ts
├── ...
└── index.ts
```

The modules group into a few families.

- **Graph**: `model`, `ontology`, `graph-validation`, `reference`. The graph shapes, their type descriptors, and the evidence a claim rests on.
- **Handoff**: `handoff`, `proposal`, `proposal-preview`, `clarification`. A point a run reached that only a person can settle, always from a run to a person and never the reverse.
- **Output**: `block`. The typed calls a run renders with, and therefore what every surface draws.
- **Orchestration**: `batch`, `reactor`, `skill`, `source-unit`, `source-sync`, `coverage`. Records of automated runs over sources, and what the model has so far made of each document.
- **Config**: `source`, `mcp`, `storage`, `agent`, `embedding`, `workspace`. The product manifest and what it declares.
- **Cross-Cutting**: `common`, `error`, `event`, `history`, `user`, `capability`, `locale`, `view`, `plugin`. Primitives and contracts shared across the rest.

## Descriptions

A field's `.describe()` is the only thing a model calling the tool reads about it, since the gateway copies it into the tool's `inputSchema` and a TS comment does not exist at runtime. Two tests walk the specs Braid serves and name any field a caller could send with nothing to go on.

- **One Voice**: A statement about the field, never an instruction to whoever holds it. Nothing addresses the caller as `you`, which is checked.
- **One Definition Point**: Prose sits on the shared const or branded id, and a use site restates it only where the meaning narrows (`fromNodeId`).
- **Say It Once**: Describe the registered component rather than the `$ref` pointing at it, and let a union arm speak through its discriminant, which is the only part of an arm a model sees.
- **Absent, Or Unset**: A sentence about a missing value opens with `Absent`. A value the server settles ends with `so a run leaves it unset`, which is the fact a model needs and optionality alone does not carry.
- **Containers**: An array or object carries prose only for a decision its fields do not hold, such as `applied together or not at all`.
- **No Ontology Vocabulary**: A description may say a value comes from the workspace's ontology, never name a node type, source role, or audience.

An operation carries prose of its own only for a rule spanning more than one field. A tool on the deployment endpoint always carries one, written for a client handed a token and no prompt.

## Boundaries

These are the rules that keep schema a pure contract. They are enforced in review.

- **Validated or Shared**: A shape earns a place here when it crosses a trust boundary, either parsed from outside the process (an HTTP body, a file on disk, config) or shared as a wire contract between packages (the SSE event stream, a render call). Pure in-process types stay in the package that uses them.
- **Only Zod Lives Here**: Every schema is defined once in this package. No other package redeclares a shape.
- **No Side Effects**: Shapes, validation, and pure helpers only. No I/O, and no import from another Braid package.
- **Closed or Open**: A fixed set is a `z.enum`, an extensible one is a branded string, and that choice is the extension boundary for plugins.
- **Types Ride With Schemas**: Every `const Foo = z.object(...)` is paired with `export type Foo = z.infer<typeof Foo>`, so consumers get both from one name.

## Dependencies

Schema depends on nothing inside Braid, so the whole monorepo can depend on it.

- **Depends On**: `zod` only.
- **Consumed By**: Every package in the monorepo.
