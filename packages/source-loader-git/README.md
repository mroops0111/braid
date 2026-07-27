# @braidhq/source-loader-git

Braid keeps a product's intent and its code aligned in one knowledge graph, and lets plugins feed that graph from outside sources. `@braidhq/source-loader-git` is the plugin that mirrors a git remote's working tree into a workspace source directory, so a repository becomes a Braid source that stays current on its own.

## Role

The git loader owns a source directory and keeps it equal to a remote branch. It provisions the directory from a clone and refreshes it on every sync, so downstream extraction sees exactly what the remote holds.

- **The Mirror**: `provision` shallow-clones the remote into the destination, and `sync` fetches then hard-resets to the tracked branch, so the directory always matches the remote.
- **The Webhook**: An optional capability that maps a clone URL to `owner/repo` and dispatches a sync on a relevant `push` or `ping`, so a repo can drive its own refresh.
- **The Interpolation**: `${VAR}` placeholders in the URL resolve against the server's process env at clone time, so a token reaches git without landing in PRODUCT.md.

## Structure

```
src/
├── GitLoader.ts    the gitLoader plugin, config schema, provision, sync, webhook
└── index.ts        re-exports the plugin and its config type
```

- **GitLoader**: The `gitLoader` plugin built through the sdk factory. It holds the zod config schema, the provision and sync passes over `simple-git`, the change-count diff, and the webhook `repoIdentity` and `shouldDispatch` rules.

## Provision and Sync

`provision` removes the destination, shallow-clones the remote there at `depth` (default 1), and records the resolved sha. `sync` fetches the tracked branch and runs `git reset --hard origin/<branch>`, so the working tree always matches the remote. Local edits under the destination are discarded by design, since the directory is a mirror, not a scratchpad. Reach for the manual loader when you want to hand-manage a directory instead.

The webhook capability dispatches a sync on a `push` to the tracked branch, on either `main` or `master` when no branch is configured, and on `ping`. Other events and pushes to other refs are skipped, so an unrelated event never spends a fetch.

## Boundaries

- **Owns Its Directory**: The destination is the loader's to clone and reset. It is a mirror of the remote, so anything written there by hand is lost on the next sync.
- **No Credentials On Disk**: Tokens travel through `${VAR}` interpolation from the process env. They reach git for the clone and are never written to PRODUCT.md or the source tree.
- **A Plugin, Not A Service**: It implements core's `SourceLoader` port through the sdk factory. It clones and resets, it does not schedule itself or hold state beyond the working tree.

## Dependencies

- **Depends On**: `@braidhq/core` for the `SourceLoaderPlugin` port, `@braidhq/schema` for shared types, `@braidhq/sdk` for the `defineSourceLoaderPlugin` factory, `simple-git`, and `zod`.
- **Consumed By**: The server composition root, where `composeFsApp` registers `gitLoader` in the default plugin bundle.
