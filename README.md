# Braid

[![CI](https://github.com/mroops0111/braid/actions/workflows/ci.yml/badge.svg)](https://github.com/mroops0111/braid/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![AG-UI](https://img.shields.io/badge/AG--UI-protocol-6E56CF.svg)](https://github.com/ag-ui-protocol/ag-ui)

_A harness framework that keeps AI and your team building one domain model together, in a loop where the AI drafts and asks, and people decide._

![Braid Studio: answering a clarification, running clarify, then reviewing and applying the proposal to the domain model](demo.gif)

_A finished model is in the repository. [`examples/conciergent`](examples/conciergent/) is 120 nodes and 159 edges Braid derived from one real codebase with no intent documents, the clarifications it raised and the proposals a person applied alongside it._

**A shared model of your business, not another code graph.** Code is what shipped. Intent is what the team meant. They drift apart every sprint, and the team ends up arguing about which one is right.

Braid _braids_ them back into one domain model that engineers and PMs can both read. The default ontology is Domain-Driven Design (DDD), so people and the AI both speak the ubiquitous language of the domain instead of class names and package paths.

## Features

- **Human-in-the-Loop Gate**: the AI drafts and asks, but a person decides before any change lands, and the decision commits to Git, so any point in the model's history is restorable.
- **Evidence Down to the Line**: a node names the source it was drawn from and the lines it came from, and a node still missing evidence for a source the ontology asks for says which one.
- **Named Disagreement**: a source that merely changed is read again, which is mechanical. A model that disagrees with its own evidence, or two sources that disagree with each other, is raised as a finding carrying every reference involved, because that one needs a person to say which is right.
- **Typed Output, Shaped for a Reader**: a skill fills in a fixed set of typed calls instead of writing a page, so a surface decides the layout rather than the model does, and the readers an ontology declares decide how much of a reference each one is shown. The whole run travels over AG-UI.
- **Any Kind of View**: the graph projects into whatever a view generator declares. A document is one kind, written from material off the graph rather than kept in sync by hand, and the next kind is a plugin rather than a fork.
- **Continuous Reaction**: as sources change, Braid feeds the diff back as a fresh Proposal, so the one canonical graph keeps up instead of becoming a snapshot of the day it was built.

## Motivation

Braid is built against three failure modes.

- **Code-Only Graphs**: tools that pull a graph straight from source are honest about what runs, but the result is a class-and-call-site graph. It cannot tell you why a feature exists, who asked for it, or what trade-off shaped its rules. PMs cannot read it.
- **Doc-Only Knowledge**: PRDs, design docs, Notion, and Confluence speak the domain, but nobody keeps them in sync once the code lands. Several months later, nobody trusts them.
- **Retrieval Alone**: pointing a capable agent at the repository does answer the question, and answers it again from scratch the next time somebody asks. Whatever a reviewer worked out and accepted is not written down anywhere the next question can reach, so the same judgement gets made again, by a different reader, and possibly differently. Braid's graph is where that judgement is kept.

## Design

Braid is a pluggable framework over a fixed runtime shape. The axes are swappable, the review loop and the human gate are not.

### Framework

Every axis is a plugin, and the defaults are a starting point rather than a built-in assumption.

- **Swappable Axes**: the ontology, source loaders, storage, agent, and view generators are all plugins, each overridable in one manifest field.
- **Framework Invariants**: the human-in-the-loop gate, the evidence requirement, and the branded type discipline are enforced by the type system and cannot be swapped out.
- **Braid Anything**: the domain lives in the ontology, not the engine, so the same loop, gate, and provenance carry over whether you braid a codebase, a research corpus, or a product spec.

### A Run's Output

A skill does not write a page. It renders by calling a tool, and each render call is a route on Braid's own OpenAPI spec and therefore a named MCP tool with its own schema, so the model fills in fields and never picks a presentation.

- **One Definition, Three Jobs**: `RenderBlock` lives in `@braidhq/schema`, the one layer the server and Studio both see, so a single zod object is the route body, the tool schema, and the renderer's type at once. Ten calls, from `showAnswer` and `showEvidence` to `showSubgraph` and `showCheck`.
- **The Surface Decides the Layout**: a block says what it is and never how it sits, which is what lets one sequence be a scrolling answer on Ask and a page on Documents, drawn by one set of components.
- **Written for a Reader**: the ontology declares its audiences, and a block may name one. Most of an answer names nobody and everyone sees it. What differs is the part written for the reader who is here, and how much of a reference that reader is shown.
- **Scoped to the Run**: an operation declares which kinds of run may see it, and the spec a run's gateway reads is narrowed before it goes out. An `ask` run does not decline to propose, it cannot see the call.
- **Carried by AG-UI**: the run travels over [AG-UI](https://github.com/ag-ui-protocol/ag-ui) at `GET /workspaces/:workspaceId/agui`, and Studio reads it with the protocol's own `HttpAgent`. Using the stock client is the only objective test that the endpoint is the protocol rather than something shaped like it, and any other AG-UI client reaches Braid the same way.

### Reading the Graph

Three ways out, and none of them is an export.

- **Ask**: a one-off question answered over the graph, as blocks.
- **Views**: a view kind is a plugin axis, so a document is one kind of view rather than the only one there can be. A generator declares what it may be written about and the forms it writes, projects the subject into material off the graph, and one skill per form writes the page. Because the projection is a function, re-projecting and comparing is what tells a reader the graph has moved past a view, without anything tracking it.
- **MCP**: a read-only MCP endpoint at `<api>/braid/mcp` over streamable-http, carrying seven operations: the workspace list, node search, one node, a node's neighbourhood, the edges, the ontology, and the whole snapshot. It exchanges each caller's own token, so somebody's MCP client reads the graph as them and the run history says who asked.

### Architecture

The server is the composition root. Sources feed an event-driven engine that produces reviewable changes, a human gate lands them in one canonical model, and every write is versioned in Git.

![Braid architecture](architecture.png)

- **Surfaces**: Studio (web UI), Desktop, and MCP clients all talk to one server. The graph, the queues, and the workspace are REST with an SSE event stream beside them, and a run is read over AG-UI. The CLI reads no run at all, it scaffolds a workspace and boots the stack.
- **Sources**: Intent (PRDs, RFCs, issues) and Code (repositories) are pulled in by Source Loader plugins for git, github, gdrive, and any API a single MCP tool can page through.
- **Engine (The HITL Loop)**: the Agent runs Skills as subprocesses, and a Skill renders its output as typed blocks. Where a run reaches a point only a person can settle it emits a Handoff, either a Proposal (a proposed change to the model) or a Clarification (a question to resolve ambiguity). Both land in one queue, because what makes them one kind is who must act next.
- **Model**: an Ontology types the graph, the Graph is the single source of truth, and a Storage plugin such as Kuzu persists it. Where a node and its evidence part company the disagreement is recorded on the node, re-derived on every build, and either fixed at the source or acknowledged as intended.
- **Reads**: Ask answers a one-off question over the graph as blocks, a View Generator projects it into whatever kind of view it declares, and a read-only MCP endpoint serves the graph to a person's own client. See Reading the Graph above.
- **History**: every human-gated write commits to Git. The graph state travels alongside the code as a `model.json` snapshot, so any commit is restorable.

## Usage

Get a workspace running, then work the review loop in Studio.

### Quick Start

Braid runs from the monorepo today. You need Node 20 or later, pnpm, and the `claude` CLI signed in, since a skill run is a subprocess of it and nothing runs without one.

```bash
git clone https://github.com/mroops0111/braid
cd braid && pnpm install && pnpm dev
# Studio at http://localhost:5173, server at :4321
```

Open Studio and create a workspace with the Wizard, then add your intent and code sources. The default ontology is DDD.

`5173` is Vite's dev server and exists only in a checkout. A deployment serves the built bundle from the API process instead, on one origin and one port. `compose.yaml` is a working example, and [`@braidhq/server`](packages/server/README.md#deployment) names every variable the server reads and what each does when absent.

### The Loop

Once the dev server is running, work the loop in Studio at `http://localhost:5173`.

- **Build**: open Build, which lists every source document and what the model has made of it. Run the ontology's pipeline over one document or over a group. The steps across the top are read from the ontology's own build skills, so swapping the ontology changes the pipeline and nothing else.
- **Review**: open the Inbox, which is one queue. A question the run stopped on and a change it proposed are two kinds of card in the same list, because answering the question is what carries the run on.
- **Apply**: land the change when it is green, or reject it with a reason.
- **Read**: ask a one-off question on Ask, or write the graph into a document on Documents and pick the form it should take.

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

## Status

Braid is at `0.6.0` and pre-1.0. It is used against real workspaces, and the shape of the graph, the review loop, and the human gate have held for months. The surfaces and the plugin contracts still move between minor versions, and a release that breaks one says so.

## License

[MIT](LICENSE)
