# Braid

[![CI](https://github.com/mroops0111/braid/actions/workflows/ci.yml/badge.svg)](https://github.com/mroops0111/braid/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

_A harness framework that keeps AI and your team building one domain model together, in a loop where the AI drafts and asks, and people decide._

![Braid Studio: answering a clarification, running clarify, then reviewing and applying the proposal to the domain model](demo.gif)

**A shared model of your business, not another code graph.** Code is what shipped. Intent is what the team meant. They drift apart every sprint, and the team ends up arguing about which one is right.

Braid _braids_ them back into one domain model that engineers and PMs can both read. The default ontology is Domain-Driven Design (DDD), so people and the AI both speak the ubiquitous language of the domain instead of class names and package paths.

## Features

- **Human-in-the-Loop Gate**: the AI drafts and asks, but a person decides before any change lands.
- **Evidence-Backed Claims**: every node traces back to the file or document it was drawn from.
- **Typed Output, Not Prose**: a run renders by calling a tool with a schema, so what arrives is a sequence of typed blocks rather than a wall of text.
- **A Standard Protocol on the Wire**: a run is read over AG-UI, and Studio consumes it with a stock client, so any other AG-UI client reaches Braid the same way.
- **Docs That Never Drift**: a document is written from material projected off the model, so when the graph moves the document is marked stale instead of quietly going wrong.
- **Continuous Reaction**: as sources change, Braid feeds the diff back as a fresh Proposal instead of going stale.
- **Git-Versioned History**: every human-gated write commits to Git, so any point in the model's history is restorable.

## Motivation

Braid is built against two failure modes.

- **Code-Only Graphs**: tools that pull a graph straight from source are honest about what runs, but the result is a class-and-call-site graph. It cannot tell you why a feature exists, who asked for it, or what trade-off shaped its rules. PMs cannot read it.
- **Doc-Only Knowledge**: PRDs, design docs, Notion, and Confluence speak the domain, but nobody keeps them in sync once the code lands. Several months later, nobody trusts them.

## Design

Braid is a pluggable framework over a fixed runtime shape. The axes are swappable, the review loop and the human gate are not.

### Framework

Every axis is a plugin, and the defaults are a starting point rather than a built-in assumption.

- **Swappable Axes**: the ontology, source loaders, storage, agent, and view generators are all plugins, each overridable in one manifest field.
- **Framework Invariants**: the human-in-the-loop gate, the evidence requirement, and the branded type discipline are enforced by the type system and cannot be swapped out.
- **Braid Anything**: the domain lives in the ontology, not the engine, so the same loop, gate, and provenance carry over whether you braid a codebase, a research corpus, or a product spec.

### Typed Blocks

A skill does not write prose. It renders by calling a tool, and each render call is a route on Braid's own OpenAPI spec and therefore a named MCP tool with its own schema, so the agent fills in fields instead of formatting a page.

- **One Definition, Three Jobs**: `RenderBlock` lives in `@braidhq/schema`, the one layer the server and Studio both see, so a single zod object is the route body, the tool schema, and the renderer's type at once.
- **No Layout in a Block**: a block says what it is and never how it sits, which is what lets the same sequence be a scrolling answer on Ask and a page on Documents.
- **Ten Calls**: `showAnswer`, `showEvidence`, `showFinding`, `showMatrix`, `showTrace`, `showDiagram`, `showSubgraph`, `showSection`, `showCheck`, and `showCustom`.
- **Scoped to the Run**: an operation declares which kinds of run may see it, and the spec a run's gateway reads is narrowed before it goes out. An `ask` run does not decline to propose, it cannot see the call.

### AG-UI on the Wire

A run is read over [AG-UI](https://github.com/ag-ui-protocol/ag-ui), at `GET /workspaces/:workspaceId/agui`. This is a claim a reader can check rather than take on trust.

- **A Stock Client**: Studio consumes the endpoint with AG-UI's own `HttpAgent`, which is the only objective test that the endpoint is the protocol rather than something shaped like it.
- **One Translation, at the Edge**: the mapping from agent events to protocol events happens only at the server's boundary and leaks no agent knowledge, so a second agent that speaks AG-UI natively moves the translation rather than the surfaces.
- **Open to Other Clients**: any AG-UI client reaches Braid the same way Studio does.

### Documents as Projections

A document is not a file somebody exported. It is a stored sequence of render calls, written in two halves.

- **The Projection Is a Function**: a view generator projects a subject into material JSON off the graph, so the same graph and subject give the same bytes, and nothing deterministic passes through model output.
- **The Wording Is a Skill**: each form ships its own skill that reads that material and writes the page. `@braidhq/view-generator-doc` ships `reference` and `tutorial`, and neither is handed a template.
- **Order Comes From the Ontology**: the projection walks `renderHint`, so a second ontology gets documents without that package changing.
- **Staleness Falls Out**: project the subject again and compare it against the material the document was written from. An edit that changes nothing a reader would read leaves the document current.

### Architecture

The server is the composition root. Sources feed an event-driven engine that produces reviewable changes, a human gate lands them in one canonical model, and every write is versioned in Git.

![Braid architecture](architecture.png)

- **Surfaces**: Studio (web UI), Desktop, and MCP clients all talk to one server. The graph, the queues, and the workspace are REST with an SSE event stream beside them, and a run is read over AG-UI. The CLI reads no run at all, it scaffolds a workspace and boots the stack.
- **Sources**: Intent (PRDs, RFCs, issues) and Code (repositories) are pulled in by Source Loader plugins for git, github, gdrive, and any API a single MCP tool can page through.
- **Engine (The HITL Loop)**: the Agent runs Skills as subprocesses, and a Skill renders its output as typed blocks. Where a run reaches a point only a person can settle it emits a Handoff, either a Proposal (a proposed change to the model) or a Clarification (a question to resolve ambiguity). Both land in one queue, because what makes them one kind is who must act next.
- **Model**: an Ontology types the graph, the Graph is the single source of truth, and a Storage plugin such as Kuzu persists it.
- **Reads**: Ask answers a one-off question over the graph as blocks, and a View Generator declares the view kinds it can write and the forms it writes them in, which the Documents surface shelves by subject rather than by filename.
- **History**: every human-gated write commits to Git. The graph state travels alongside the code as a `model.json` snapshot, so any commit is restorable.

## Usage

Get a workspace running, then work the review loop in Studio.

### Quick Start

Braid runs from the monorepo today. Clone it, install, and start the dev stack.

```bash
git clone https://github.com/mroops0111/braid
cd braid && pnpm install && pnpm dev
# Studio at http://localhost:5173, server at :4321
```

Open Studio and create a workspace with the Wizard, then add your intent and code sources. The default ontology is DDD.

`5173` is Vite's dev server, which exists only in a checkout. A deployment serves the built bundle from the API process instead, so there is one origin and one port. See Deployment below.

### The Loop

Once the dev server is running, work the loop in Studio at `http://localhost:5173`.

- **Build**: open Build, which lists every source document and what the model has made of it. Run the ontology's pipeline over one document or over a group. The steps across the top are read from the ontology's own build skills, so swapping the ontology changes the pipeline and nothing else.
- **Review**: open the Inbox, which is one queue. A question the run stopped on and a change it proposed are two kinds of card in the same list, because answering the question is what carries the run on.
- **Apply**: land the change when it is green, or reject it with a reason.
- **Read**: ask a one-off question on Ask, or write the graph into a document on Documents and pick the form it should take.

### Deployment

A deployment is one container serving the API and the UI on one origin. `compose.yaml` at the root is a working example, and [`@braidhq/server`](packages/server/README.md#deployment) documents every variable the server reads.

Two of them decide whether a deployment works at all.

- **`BRAID_STUDIO_ROOT`**: the built Studio files this process should serve. `@braidhq/studio` ships them and its `assets` entry reports the path. Unset, the server serves no UI and answering `/` is the API's job, which is what a bare JSON `401` at the root means.
- **`BRAID_HOME`**: the directory holding the workspaces, the registries, the source mirrors, and each workspace's git history. Unset it falls back to `~/.braid`, so a container started without it comes up healthy, reads a fresh empty directory, and reports no workspaces.

## Packages

**Framework Core**

| Package | Description |
|---|---|
| [`@braidhq/schema`](packages/schema/) | Zod schemas and branded types. The wire-format contract for every package. |
| [`@braidhq/core`](packages/core/) | Domain entities, application services, and plugin port interfaces, with no concrete adapters. |
| [`@braidhq/sdk`](packages/sdk/) | Author SDK for ontology, source loader, and view generator plugins. |

**Plugins**

| Package | Description |
|---|---|
| [`@braidhq/ontology-ddd`](packages/ontology-ddd/) | Default DDD ontology: boundedContext, aggregate, command, query, event, rule, and actor. |
| [`@braidhq/storage-kuzu`](packages/storage-kuzu/) | Embedded Kuzu graph store, a zero-infra single-binary alternative to Neo4j. |
| [`@braidhq/source-loader-git`](packages/source-loader-git/) | Clone a repository and sync it automatically. |
| [`@braidhq/source-loader-github`](packages/source-loader-github/) | Sync a GitHub repository over the API, OAuth on first use. |
| [`@braidhq/source-loader-gdrive`](packages/source-loader-gdrive/) | Export documents from Google Drive, OAuth on first use. |
| [`@braidhq/source-loader-mcp`](packages/source-loader-mcp/) | Mirror an API-backed source by paging one MCP tool, one file per item. |
| [`@braidhq/view-generator-doc`](packages/view-generator-doc/) | Project a container node into material, and write it as a `reference` or a `tutorial`. |
| [`@braidhq/agent-claude-code`](packages/agent-claude-code/) | Runs the `claude` CLI to execute SKILL.md prompts, the default LLM backend. |

**Surfaces**

| Package | Description |
|---|---|
| [`@braidhq/server`](packages/server/) | REST and SSE server, the composition root. |
| [`@braidhq/cli`](packages/cli/) | Command-line entry point. |
| [`@braidhq/studio`](packages/studio/) | Web UI. |
| [`@braidhq/desktop`](packages/desktop/) | Tauri desktop shell. |

## Extending Braid

Braid has two extension surfaces, and neither touches the core. A TypeScript plugin adds a swappable axis. A Markdown skill adds an AI capability.

A plugin implements a port and registers at server start-up, then a workspace opts in by name. See [`@braidhq/sdk`](packages/sdk/) for the five `define*Plugin` builders. The shipped plugins, such as [`@braidhq/storage-kuzu`](packages/storage-kuzu/) and [`@braidhq/source-loader-git`](packages/source-loader-git/), are reference implementations to copy from. A view generator is the one axis that ships skills of its own, because it decides what a document covers and in what order while leaving what the sentences say to a skill.

A skill is a `SKILL.md` file at `<workspace>/skills/<verb>/SKILL.md`, invoked as `/workspace:<verb>`. Its `category` decides where it belongs and what it is offered.

- **`ask`**: answers a question on Ask, and is offered the render calls but no way to write to the model.
- **`build`**: runs from Build over a source document, and may propose. `order` places it in the pipeline across the top and `label` is what a reader sees there, since `ddd:extract` is an address and not a name. One build runs at a time, since the graph only accumulates.
- **`generate`**: writes a document, and is the only category offered `showSection`, `showCheck`, and `showCustom`.

```markdown
---
name: quick-extract
description: Extract DDD entities from intent + code
argumentHint: <ctx-name>
model: opus
braid:
  category: build
  requiredEnv: [GITHUB_TOKEN]
---
Walk `intent/` and `code/`. Emit proposals that add boundedContext, aggregate, and command nodes. Cite the source file or doc each claim came from.
```

The `braid:` block is preflighted before the agent spawns, so a missing env var or MCP server fails fast with a clear error.

## License

[MIT](LICENSE)
