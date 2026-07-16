# @braidhq/core

Braid keeps a product's intent and its code aligned by extracting both into one knowledge graph. `@braidhq/core` is the engine behind that graph. It holds the domain model, the services that build and review it, and the port interfaces the outside world plugs into.

## Role

Core is the framework layer every other package builds on. It owns the rules and leaves the plumbing to others.

- **The Model**: The knowledge graph as a domain aggregate, with the invariants that keep it valid.
- **The Flows**: Review, batch, and reactor services that turn agent output into committed graph changes.
- **The Ports**: Interfaces for storage, agents, and history, implemented by sibling packages rather than here.

## Structure

The source is layered inward. Application and infrastructure depend on domain, and domain depends on nothing but schema.

```
src/
├── domain/
│   ├── model/
│   ├── hitl/
│   ├── plugin/
│   └── batch/, reactor/, skill/, source/, workspace/, ...
├── application/
└── infrastructure/
```

- **domain**: Entities, ports, and value objects, one folder per aggregate. Pure, with no I/O.
  - **model/**: The `Model` aggregate with its repository and serializer.
  - **hitl/**: `Proposal` and `ClarifyTicket` with their repositories.
  - **plugin/**: Port interfaces for ontology, storage, agents, and loaders.
- **application**: Services that run one use case each, such as `HITLService`, `BatchService`, and `ReactorService`.
- **infrastructure**: In-memory default adapters and the graph validators. Vendor adapters such as Kuzu live in sibling packages.

## Naming

Application code is named by role, so the suffix tells you what a file is before you open it.

- **`*Service`**: A class that orchestrates one domain concept's use cases, wired through a `Deps` object. This is the default shape (`HITLService`, `BatchService`, `WorkspaceBootstrapService`).
- **Pattern Nouns**: A reusable mechanism takes its pattern's name instead of `Service`. A pub/sub port is a `*Bus`, a concurrency primitive is a `*Lock`, and a driver of plugin or subprocess work is a `*Runner` (`WorkspaceEventBus`, `PerWorkspaceLock`, `SourceLoaderRunner`).
- **Ports**: An interface implemented in a sibling package is named for its role, never `Service` (`Repository`, `Clock`, `Digest`, `EventBus`).
- **Functions**: A stateless helper shared by more than one caller is a camelCase function, not a single-method class (`computeSourceDiff`, `enrichCommitAuthor`).

## Boundaries

These are the rules for anyone editing core. They are enforced in review rather than by tooling.

- **Inward Dependencies**: `domain` imports neither `application` nor `infrastructure`.
- **Single Schema Source**: Every shape comes from `@braidhq/schema`. Core never redeclares a zod schema.
- **In-Process Only**: Core types describe behavior and internal state. A shape parsed from outside or shared as a wire contract belongs in schema, not here.
- **No Test Stubs in Production**: A missing implementation fails loudly through a `failing*` adapter, never a silent `null`.
- **Wiring Elsewhere**: Concrete adapters are selected at the server composition root, not inside core.

## Dependencies

Core sits one layer above `schema` and beneath everything that runs a workspace.

- **Depends On**: `@braidhq/schema` for types and validation.
- **Consumed By**: `server`, `sdk`, `cli`, and every plugin package such as `storage-kuzu`, `agent-claude-code`, `ontology-ddd`, and `source-loader-*`.
