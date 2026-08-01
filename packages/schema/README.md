# @braidhq/schema

Braid keeps a product's intent and its code aligned in one knowledge graph. `@braidhq/schema` is the contract for that graph. Every data shape in Braid is defined here once, as a zod schema paired with its TypeScript type, and every other package imports from here.

## Role

Schema is the root of the monorepo. It says what data looks like, and nothing about what happens to it.

- **The Shapes**: Every entity, message, and config as a zod schema with an inferred type, so validation and typing come from one definition.
- **The Ids**: Branded identifiers, so a `NodeId` can never be passed where a `ProposalId` belongs.
- **The Vocabulary**: The closed enums and open brands that decide which sets are fixed and which are extensible.

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

- **Graph**: `model`, `ontology`, `graph-validation`. The graph shapes and their type descriptors.
- **Review**: `proposal`, `proposal-preview`, `clarify`. The HITL artifacts a human approves.
- **Orchestration**: `batch`, `reactor`, `skill`, `source-unit`. Records of automated runs over sources.
- **Config**: `source`, `mcp`, `storage`, `agent`, `workspace`. The product manifest and what it declares.
- **Cross-Cutting**: `common`, `error`, `event`, `history`, `user`, `view`, `plugin`. Primitives and contracts shared across the rest.

## Boundaries

These are the rules that keep schema a pure contract. They are enforced in review.

- **Validated or Shared**: A shape earns a place here when it crosses a trust boundary, either parsed from outside the process (an HTTP body, a file on disk, config) or shared as a wire contract between packages (the SSE event stream). Pure in-process types stay in the package that uses them.
- **Only Zod Lives Here**: Every schema is defined once in this package. No other package redeclares a shape.
- **No Side Effects**: Shapes, validation, and pure helpers only. No I/O, and no import from another Braid package.
- **Closed or Open**: A fixed set is a `z.enum`, an extensible one is a branded string, and that choice is the extension boundary for plugins.
- **Types Ride With Schemas**: Every `const Foo = z.object(...)` is paired with `export type Foo = z.infer<typeof Foo>`, so consumers get both from one name.

## Dependencies

Schema depends on nothing inside Braid, so the whole monorepo can depend on it.

- **Depends On**: `zod` only.
- **Consumed By**: Every package in the monorepo.
