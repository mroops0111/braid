# Braid

[![CI](https://github.com/mroops0111/braid/actions/workflows/ci.yml/badge.svg)](https://github.com/mroops0111/braid/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

Intent ↔ Code alignment framework. Treat **code** as the source of truth for *what* your system does, **intent** (PRDs, RFCs, tickets) as the source of truth for *why*, and let Braid extract, merge, and HITL-validate both into a single canonical knowledge graph the whole product team can query.

```bash
git clone https://github.com/mroops0111/braid.git
cd telos && pnpm install
pnpm dev    # Studio at http://localhost:5173, server at :4321
```

- **HITL-validated graph.** AI extracts proposals from code and intent; humans review them in Studio and decide what lands. Nothing writes to the graph without an explicit Apply.
- **Multi-source workspaces.** One workspace can stitch a git repo, a Google Drive folder of PRDs, and local filesystem paths into one merged model. Source loaders are plugins.
- **Skills are markdown prompts.** Each AI capability lives in a `SKILL.md` file that runs as a Claude Code subprocess. Add a new capability by writing a prompt, not by extending a class.
- **Pluggable ontology.** Bring your own domain vocabulary. The default DDD ontology (`@braidhq/ontology-ddd`) ships boundedContext / aggregate / command / event / rule; swap or extend for a different domain.

Storage is embedded Kuzu (zero infra). API is Hono on Node 20. Studio is Vite + React; the same code targets Tauri 2 desktop later. Designed to scale from a solo developer running it locally to a self-hosted team server.

---

## Status

**Pre-1.0, building in public.** APIs, schemas, and the CLI surface will break between minor versions until 1.0. No `@braidhq/*` packages are on npm yet; clone the repo and run it locally. File issues, follow the milestone board, expect rough edges.

If you want the design rationale before the code, read [`docs/OSS-PROPOSAL.md`](docs/OSS-PROPOSAL.md) (Chinese). The thesis: code is the source of truth for fact, intent is the source of truth for why, Model is the canonical merge.

## How It Works

```
        [Intent]              [Code]
         (why)               (what / how)
            ↓ extract            ↓ extract
       intent fragment       fact fragment
              ↓                  ↓
              └────[ Merge + HITL ]────┐
                       ↓
                    [ Model ]
                  (knowledge graph)
                       ↓
              ┌────────┼────────┐
              ↓        ↓        ↓
            View      View      View
            (docs)   (Q&A)   (BDD / codegen)
```

1. **Extract.** Skills walk each source (git tree, drive folder, etc.) and produce proposals: "add node X", "link Y to Z". They never touch the graph directly.
2. **Validate.** Proposals queue up in Studio. A `StructuralValidator` checks them against the active ontology's edge topology and cardinality. Conflicts surface as Clarify tickets.
3. **Apply.** A human reviews each proposal and clicks Apply. Only then does Kuzu get a transaction. The Model is the consensus snapshot, not the AI's first guess.
4. **Project.** Views (docs, Q&A answers, BDD `.feature` files, future codegen) read from the Model on demand.

The full design doc with deployment tiers, plugin contracts, and the HITL invariant is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick Start

### 1. Set up

```bash
git clone https://github.com/mroops0111/braid.git
cd telos && pnpm install
pnpm exec braid dev    # server (:4321) + Studio (:5173)
```

The CLI lives at `@braidhq/cli`. `braid dev` runs server and Studio in parallel from inside the monorepo; `braid serve` runs the server alone. (Once published to npm, this will be `npx @braidhq/cli dev`.)

### 2. Create a workspace

```bash
pnpm exec braid init ../my-product    # scaffolds PRODUCT.md + intent/
pnpm exec braid workspace add "$(realpath ../my-product)"
```

`braid init` creates a directory with a minimal `PRODUCT.md` manifest. Edit `sources:` to point at your real intent (PRD / RFC) and code paths. The minimal manifest looks like:

```yaml
name: my-product
version: 0.1.0
ontologyId: ddd
sources:
  - kind: filesystem
    id: src-prd
    role: intent
    name: prd
    path: ./intent
  - kind: filesystem
    id: src-app
    role: code
    name: app
    path: ./code/app
    language: typescript
mcpServers: []
```

A runnable copy lives at [`examples/example-workspace/`](examples/example-workspace/). For a real git source use `kind: git` with a `url:`; for Google Drive use `kind: gdrive` with a `folderId:` (see the source-loader package READMEs).

### 3. Extract intent and code

In the workspace's **Skills** tab pick `braid-extract` and click Run. The skill spawns a Claude Code subprocess against your source paths and streams events back to Studio. Output is a stack of Proposals in the **Proposals** tab.

### 4. Review and apply

Each Proposal shows the diff against the current Model plus structural validation results. Pre-validate on click, Apply when green, Reject with a reason when not. The Apply call is the only path that writes to Kuzu.

### 5. Query the graph

The **Graph** tab visualizes the Model. Filter by node type, search by name or description, drill into a node to see its incoming and outgoing edges. The visualization is ontology-adaptive: the colors and default-visible types come from the active ontology descriptor, so a custom ontology renders correctly with no code changes in Studio.

## Architecture

Three deployment tiers, same code:

| Tier | Server runs in | Storage | Audience |
|---|---|---|---|
| **Personal** | Tauri 2 desktop (planned) | Local Kuzu | Solo developer |
| **Team** | Self-hosted VPS / serverless | Local Kuzu or remote | Product teams, git as SSoT |
| **Enterprise** | Managed cloud (planned) | Cloud Kuzu + RBAC + SSO | Large orgs |

Per-tier details (which packages run where, how `@braidhq/server` embeds vs. runs standalone, how sources sync) live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Packages

Monorepo: 10 packages + 1 plugin. Workspaces under `packages/*` and `plugins/*`.

| Package | Role | Status |
|---|---|---|
| `@braidhq/schema` | Zod schemas and TS types for the domain model. Wire format shared by core, server, studio, sdk, cli, plugins. | Stable shape, pre-1.0 |
| `@braidhq/core` | Domain entities (Workspace / Model / Proposal / ClarifyTicket / Run) + application services + infrastructure ports. | Pre-1.0 |
| `@braidhq/sdk` | Plugin SDK. `defineSource` / `defineOntology` / `defineAgent`, etc. | Pre-1.0 |
| `@braidhq/server` | REST API on Hono. Mounts routes for workspaces / proposals / runs / clarify / ontology / events (SSE). | Pre-1.0 |
| `@braidhq/storage-kuzu` | Embedded graph storage adapter. Zero-infra alternative to Neo4j. | Pre-1.0 |
| `@braidhq/source-loader-git` | Source loader plugin: clone a remote repo, sync via fetch + reset. | Pre-1.0 |
| `@braidhq/source-loader-gdrive` | Source loader plugin: pull text and image files from a Drive folder. | Pre-1.0 |
| `@braidhq/studio` | Vite + React web UI. Workspaces, Skills, Proposals, Graph. Tauri-ready. | Pre-1.0 |
| `@braidhq/cli` | Command-line entry. | Stub, not usable yet |
| `@braidhq/desktop` | Tauri 2 shell that bundles `@braidhq/server` as a sidecar and serves `@braidhq/studio`. | Planned |
| `@braidhq/ontology-ddd` | Default ontology plugin: boundedContext / aggregate / command / query / event / rule. | Pre-1.0 |

## Writing Plugins

Three plugin contracts, all behind `@braidhq/sdk`:

**Ontology.** Define the node and edge types of your domain. Set `defaultVisible` on the types Studio should show by default; set `color` on each descriptor to control the palette. See [`plugins/ontology-ddd/`](plugins/ontology-ddd/) for the full example.

**Source loader.** Pull intent or code into a workspace's source directory. The loader is just an async function returning a list of relative file paths; Braid handles dedup, diff, and propagation. See [`packages/source-loader-git/`](packages/source-loader-git/) and [`packages/source-loader-gdrive/`](packages/source-loader-gdrive/).

**Skill.** A `SKILL.md` markdown file describing how Claude Code should walk your sources and emit proposals. No TypeScript required. See [`packages/core/skills/`](packages/core/skills/) for the built-in skills (`braid-extract`, `braid-clarify`, …).

## License

[MIT](LICENSE)
