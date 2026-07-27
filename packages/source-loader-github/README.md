# @braidhq/source-loader-github

Braid keeps a product's intent and its code aligned in one knowledge graph, and lets plugins feed that graph from outside sources. `@braidhq/source-loader-github` is the plugin that ingests a repository's GitHub Issues as markdown, so the closed issues that shipped as code become intent units in a workspace.

## Role

The github loader turns a repo's Issues into a directory of markdown files, one per issue, and keeps that directory current through an incremental, cursor-based sync.

- **The Ingest**: Each issue renders to `<destination>/issues/<number>.md` with a deterministic YAML frontmatter, the body, and an optional `## Comments` section, so an unchanged issue stays byte-identical across syncs.
- **The Filter**: The realized-intent filter (always on) writes an issue only when it is closed and carries a linked merged pull request, so speculative or abandoned issues never reach the ledger.
- **The Cursor**: Sync tracks a `since` cursor on disk and reactively deletes files whose issue no longer passes the filter, so incremental runs stay cheap and the directory stays aligned.

## Structure

```
src/
├── GithubSourceLoaderPlugin.ts   the github loader, config, provision, sync, realized-intent filter, webhook
└── index.ts                      re-exports the factory and its config type
```

- **GithubSourceLoaderPlugin**: The `createGithubLoader` factory built through the sdk plugin builder. It holds the config schema, the REST issue and comment fetches, the GraphQL realized-intent check, the markdown renderer, the cursor read and write, and the webhook rules.

## Realized-intent filter

An issue is written to disk only when its state is `closed` and at least one merged pull request is cross-referenced from it. The link is read from GitHub's GraphQL `CROSS_REFERENCED_EVENT` timeline, which covers any PR that references the issue, broader than the closing-keyword association alone. This encodes Braid's intent-and-code convergence contract, so open, abandoned, and docs-only-closed issues do not pollute the graph, and a re-provision stays idempotent.

The check needs an authenticated token, since GitHub's GraphQL endpoint rejects anonymous requests. The REST issue list itself works anonymously, so this only bites once the loader reaches the linked-PR probe. Sync advances its cursor over every raw issue it examined, not just the survivors, so a not-yet-merged issue does not re-burn a GraphQL probe on every run.

## Boundaries

- **Owns Its Directory**: The `issues/` tree and the cursor file are the loader's to write. It renders deterministically, so byte-stable output keeps downstream fingerprints quiet.
- **No Credentials On Disk**: The token resolves from `${GH_TOKEN}` or any env var through `${VAR}` interpolation. Only rendered markdown lands in the destination, never the token.
- **A Plugin, Not A Service**: It implements core's `SourceLoader` port through the sdk factory, and exposes a webhook capability for `issues`, `issue_comment`, and `ping` deliveries.

## Dependencies

- **Depends On**: `@braidhq/core` for the port, `@braidhq/schema` for shared types, `@braidhq/sdk` for the factory, `yaml` for frontmatter, and `zod`.
- **Consumed By**: The server composition root, where `composeFsApp` registers the github loader in the default plugin bundle.
