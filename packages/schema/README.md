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

## Boundaries

These are the rules that keep schema a pure contract. They are enforced in review.

- **Validated or Shared**: A shape earns a place here when it crosses a trust boundary, either parsed from outside the process (an HTTP body, a file on disk, config) or shared as a wire contract between packages (the SSE event stream, a render call). Pure in-process types stay in the package that uses them.
- **Only Zod Lives Here**: Every schema is defined once in this package. No other package redeclares a shape.
- **No Side Effects**: Shapes, validation, and pure helpers only. No I/O, and no import from another Braid package.
- **Closed or Open**: A fixed set is a `z.enum`, an extensible one is a branded string, and that choice is the extension boundary for plugins.
- **Types Ride With Schemas**: Every `const Foo = z.object(...)` is paired with `export type Foo = z.infer<typeof Foo>`, so consumers get both from one name.

## Descriptions

A field's `.describe()` is the only thing a model calling the tool will ever read about it. `openapi-mcp-gateway` copies it into the tool's `inputSchema` at every depth, so a TS comment cannot stand in for one. A JSDoc block keeps what an implementer needs and nothing a caller does.

Which fields need one is not a judgement anybody makes by eye. Two tests walk the specs Braid actually serves, `runToolSurfaceDescriptions.test.ts` for the document a run is handed and `mcpToolSurface.test.ts` for the deployment's own endpoint, and name the exact path of anything a caller could send with nothing to go on.

What a line says, and how:

- **One voice**: a statement about the field, never an instruction to whoever holds it. An imperative is a statement of what the field does, so `Keep only nodes of these types` is fine and `Pass the ids you want` is not. Nothing addresses the caller as `you`, which is checked.
- **One definition point**: prose lives on the shared const or branded id, so `NodeId` says what a node id is once and every field taking one inherits it. A use site restates it only where its meaning is narrower, such as `fromNodeId`.
- **A missing value opens with `Absent`**: `Absent keeps every type`, `Absent leaves the server to derive one`, `Absent for a source with no lines`.
- **A value the server settles ends with `so a run leaves it unset`**, which is a different fact from a value being optional, and the more useful one, since a model with no such line fills the field in.
- **A container speaks only for itself**: an array or object carries prose when it holds a decision its fields do not, such as `applied together or not at all`. Otherwise the fields say it.
- **A registered component says it once**: describe the component, not the `$ref` that points at it, since a description written beside a bare `$ref` is dropped on the way out.
- **A union arm speaks through its discriminant**: the gateway builds one model per variant from the variant's fields, so an arm's own description is the one part a model never sees.
- **Values in backticks**: `draft`, `error`, `blocks`. Numeric levels stay bare.
- **No ontology vocabulary**: a description may say a value comes from the workspace's ontology and may name a framework concept, but never a concrete node type, source role, or audience, which is checked the way the framework skills are.

An operation carries prose of its own only for a rule spanning more than one field, such as a proposal applying every operation in it or none. A tool on the deployment endpoint always carries one, written for a client that was handed a token and no prompt.

## Dependencies

Schema depends on nothing inside Braid, so the whole monorepo can depend on it.

- **Depends On**: `zod` only.
- **Consumed By**: Every package in the monorepo.
