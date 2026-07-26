# @braidhq/cli

Braid keeps a product's intent and its code aligned in one knowledge graph. `@braidhq/cli` is the `braid` command, the terminal front door for scaffolding a workspace and running the stack locally.

## Role

The entry point a user reaches for first. It scaffolds a workspace and boots the stack without any hand-wiring, then gets out of the way. It owns no logic of its own; each command is a thin shell over the server or the filesystem.

- **Scaffold**: `braid init` lays down a workspace template on disk.
- **Run**: `braid serve` boots the server, `braid dev` runs the server and Studio together for local development.
- **Inspect**: `braid workspace list` queries a running server over HTTP.

## Commands

- `braid init <dir>` scaffolds a workspace template. Options: `--ontology` (default `ddd`), `--name` (default the directory basename), `--force` to overwrite an existing `PRODUCT.md`.
- `braid serve` runs the server. `--port` defaults to `4321`.
- `braid dev` runs the server and Studio together. In a monorepo checkout it spawns both dev processes so edits reload live; standalone it runs the server only. `--port` sets the server port, Studio stays on `5173`.
- `braid workspace list` lists the workspaces on a running server. `--api` defaults to `http://localhost:4321`.

## Structure

```
src/
├── main.ts            cac command definitions, the braid binary
└── commands/
    ├── init.ts        scaffold a workspace template on disk
    ├── serve.ts       boot the server via the server package's startServer
    ├── dev.ts         run server and Studio, monorepo or standalone
    └── workspace.ts   query a running server over HTTP
```

## Boundaries

- **Orchestrates, does not implement.** `serve` delegates to `@braidhq/server`'s `startServer`, so env loading, graceful shutdown, and background recovery match the server binary exactly. `init` only writes files. `workspace` talks to a server over HTTP.
- **Does not register a workspace.** `init` lays down the template on disk. Registration with a server is a Studio Wizard flow, not a CLI step.
- **Holds no state.** Nothing here persists between invocations.

## Dependencies

- `@braidhq/server` for `startServer` and root env loading, so `serve` and `dev` share the server's boot path.
- `cac` for command parsing, `picocolors` for terminal colour.
