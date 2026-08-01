# @braidhq/storage-kuzu

Braid keeps a product's intent and its code aligned in one knowledge graph, and lets plugins swap where that graph lives. `@braidhq/storage-kuzu` is the plugin that persists the graph in an embedded [Kùzu](https://kuzudb.com) database, a zero-infra single-binary alternative to running Neo4j.

## Role

The default storage backend. It implements core's `ModelRepository` port over Kùzu, so the rest of Braid reads and writes the graph without knowing a database is involved.

- **The Plugin**: `kuzuStoragePlugin` registers under the `kuzu` kind through the sdk factory, so the composition root selects it by kind rather than importing the repository class.
- **The Repository**: `KuzuModelRepository` opens one Kùzu database per workspace at `<workspace>/.braid/model.kuzu`, caches the connection, and serves loads, filtered lists, and neighbourhood scopes.
- **The Codec**: A translation layer between `GraphNode` / `GraphEdge` and Kùzu rows, so branded ids and validated metadata survive the round trip through the database.

## Structure

```
src/
├── KuzuStoragePlugin.ts    the kuzuStoragePlugin, kind and config, resolves the db path
├── KuzuModelRepository.ts   the ModelRepository over Kùzu, connect cache, load, write, scope
├── schema.ts                the Node and Edge DDL, one generic table each
├── codec.ts                 GraphNode / GraphEdge to and from Kùzu rows
└── index.ts                 re-exports the plugin and the repository
```

- **schema**: One generic `Node` table and one generic `Edge` table cover every ontology, because the Braid ontology lives in `type` and `metadata` properties, not in Kùzu's table catalogue. Migrations track Braid schema changes, not user ontology edits.
- **codec**: `nodeToParams` / `edgeToParams` bind a graph entity to statement params, `rowToNode` / `rowToEdge` read a query row back. Metadata and embeddings parse through the schema, so a malformed row fails loudly.

## Writes and Reads

Writes use diff-against-snapshot semantics. `applyOperations` loads the current snapshot, previews the operations through the domain `Model`, which validates them and mints ids, then translates the before-and-after diff into Cypher inserts, updates, and deletes over prepared statements. Domain invariants stay in one place, and the Kùzu layer stays non-transactional until a real need appears. Each write ends with an explicit `CHECKPOINT` so the write-ahead log merges into `model.kuzu` before returning, since a dirty shutdown would otherwise drop an unmerged log.

Reads load a full snapshot and filter in memory. `listNodes` and `listEdges` apply the requested filter, `scopeOf` runs a bounded breadth-first walk from a seed node. Kùzu mmaps its max database size up front, so the repository caps it at 1 GiB by default, overridable via `BRAID_KUZU_MAX_DB_SIZE`, to stay friendly to constrained CI runners.

## Boundaries

- **A Repository, Not a Domain**: The plugin translates diffs into Cypher. It never previews or validates operations itself, that is the domain `Model` passed in from core.
- **One Database Per Workspace**: Each workspace owns an isolated Kùzu directory. Nothing here reaches across workspaces.
- **Schema Is Upstream**: Node and edge shapes, branded ids, and metadata all come from `@braidhq/schema`. The codec round-trips them, it declares no shapes of its own.

## Dependencies

- **Depends On**: `@braidhq/core` for the `ModelRepository` and `StoragePlugin` ports and the domain `Model`, `@braidhq/schema` for the graph types, `@braidhq/sdk` for the `defineStoragePlugin` factory, `kuzu`, and `zod`.
- **Consumed By**: The server composition root, where `composeFsApp` registers `kuzuStoragePlugin` as the default storage backend.
