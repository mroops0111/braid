# Handoff: post-Model-A-refactor (2026-05-17)

Big refactor pass landed on top of v0.0.1 to make the plugin architecture honest. Everything below is the state of the branch right now; pick the next task off the open list at the bottom.

## What changed in this pass

### Architecture

- **Five plugin axes** (down from seven): Ontology / SourceLoader / Storage / Agent / ViewGenerator. Validator + Channel axes both dropped.
  - Validator wasn't axis-shaped: 2 of 4 built-ins were framework invariants (Evidence, OrphanEdge → inline in `ValidationService`), 2 were ontology-coupled engines (OntologyType, Structural → auto-bound by `defineOntology()` onto `OntologyPlugin.validators[]`). The user-facing "Validator plugin" interface was deleted; framework-invariant `class`es stay in `@braidhq/core` but are no longer Plugins.
  - Channel conflated "client app" with "alternative server transport". CLI / Studio / Desktop / future MCP-server are independent packages, not server-internal plugins.
- **Plugin interfaces renamed for consistency**: `Ontology` → `OntologyPlugin`, `SourceLoader` → `SourceLoaderPlugin`, `Generator` → `ViewGeneratorPlugin`. `AgentPlugin` / `StoragePlugin` already had the suffix.
- **`OntologyPlugin` gains `validators: readonly OntologyValidator[]`**: every ontology brings its own enforcement. `defineOntology()` auto-attaches `OntologyTypeValidator` + `StructuralValidator` bound to the ontology being built.
- **`ValidationService.validate(snapshot, workspace)`**: workspace param threaded through `HITLService.assertOperationsValid` so framework + ontology validators run together with the correct active ontology.
- **All composition through `PluginRegistry`**: `composeFsApp` registers default plugins (kuzu, ddd, git, claude-code) and resolves actives via `requireStoragePlugin(kind)` / `requireAgentPlugin(kind)` etc.; callers add more through `extraOntologyPlugins` / `extraStoragePlugins` / `extraSourceLoaderPlugins` / `extraAgentPlugins`.
- **`@braidhq/agent-claude-code` extracted** to its own npm package, consistent with `@braidhq/storage-kuzu` / `@braidhq/ontology-ddd` / `@braidhq/source-loader-*`. Server depends on it; it no longer lives in `server/src/infrastructure/agent/`.

### Schema cleanup

- `ProductManifest.channels` dropped (dead schema).
- `Workspace.pluginConfig.plugins` dropped (dead schema).
- `PluginType` enum reduced to the five active axes: `agent / ontology / source-loader / storage / view-generator`.

### Ontology

- `@braidhq/ontology-ddd` gains `actor` node type + `performedBy` edge (`command / query → actor`, N:N), matching the proposal §6.1 spec.

### Tests

- New `packages/server/test/integration/e2e.test.ts` — 7 cases covering the full Model-A flow: scaffold → validator rejection (framework + ontology) → apply → storage write-through → REST read-back → filesystem artifact verification. Runs in ~700 ms without spawning `claude`.
- All package suites green: schema 16 / core 17 / sdk 1 / server 21 / cli 2 / studio 4 / ontology-ddd 1 / storage-kuzu 1 / source-loader-git 1 / source-loader-gdrive 1 / agent-claude-code 1.

### Docs

- New `docs/PACKAGES.md` is the authoritative source for package + plugin architecture. Topics: Model A (per-implementation packages), ownership tiers (A First-party / B Community / C Workspace-local / D Commercial), Plugin axes table, interface UML, dependency graph, audit results, plugin-author recipes.
- `docs/ARCHITECTURE.md` header points at PACKAGES.md for the package/plugin topic; §10-§11 of ARCHITECTURE.md explicitly marked as superseded.
- README updated with the 5-axis taxonomy + `composeApp` / `composeFsApp` two-entry composition + agent-claude-code in the package table.

## Package inventory after this pass

| Package | Role | Tier |
|---|---|---|
| `@braidhq/schema` | Host (Zod, types) | Host |
| `@braidhq/core` | Host (domain + ports + in-mem fakes) | Host |
| `@braidhq/sdk` | Host (plugin builders) | Host |
| `@braidhq/server` | Host (Hono + composition root) | Host |
| `@braidhq/cli` | Host (`braid` binary) | Host |
| `@braidhq/studio` | Client (Vite SPA, private) | Client |
| `@braidhq/desktop` | Client (Tauri shell, placeholder, private) | Client |
| `@braidhq/ontology-ddd` | First-party Ontology plugin | Plugin |
| `@braidhq/storage-kuzu` | First-party Storage plugin | Plugin |
| `@braidhq/source-loader-git` | First-party SourceLoader plugin | Plugin |
| `@braidhq/source-loader-gdrive` | First-party SourceLoader plugin | Plugin |
| `@braidhq/agent-claude-code` | First-party Agent plugin | Plugin |

12 packages, 9 published. All host packages own a clear contract; all plugin packages implement one of the five axes; clients consume the host over REST/SSE.

## Architectural invariants kept (do not break)

- **HITL invariant**: Only `HITLService.applyProposal` writes the graph. Skills emit Proposal / ClarifyTicket JSON via the REST API; the route handler dispatches through HITLService.
- **Server doesn't call LLM in-process**: AI work goes through `SkillRunner` → subprocess (`agent-claude-code`'s `ClaudeCodeAgentBinding`).
- **Subprocess doesn't write the graph directly**: skills POST proposals; HITLService applies.
- **Layer direction**: `schema → domain → application → infrastructure → presentation`. `@braidhq/core` never imports from `@braidhq/server` or any concrete adapter. Plugin packages depend on `core` + `schema` + `sdk`; never on each other.
- **Plugin import discipline**: Plugin authors use `@braidhq/sdk` (`defineOntology` / `defineSourceLoader`) or implement the port interfaces from `@braidhq/core` (`StoragePlugin` / `AgentPlugin` / `ViewGeneratorPlugin`). They never import concrete classes from another plugin.
- **`PluginRegistry` is the only routing surface**: composition root registers; services resolve via `requireXxxPlugin(kind)` at call time. No static `import { ... } from '@braidhq/ontology-ddd'` outside `composeFsApp`'s defaults bundle.
- **Branded IDs end-to-end**: Zod `brand()` everywhere. No raw `string` IDs cross module boundaries. ID minting goes through `newXxxId()` in `@braidhq/core/domain/ids.ts`.
- **GraphOperation 12-variant union**: every `switch` over `.operation` uses the exhaustive `never` default.
- **Composition root is one file**: `packages/server/src/composeFs.ts`. No `new XxxRepository()` outside it or the in-memory test fakes.
- **In-memory adapters are test-only**: `core/src/infrastructure/in-memory/` exists for unit tests; production paths go through Fs* adapters + the active StoragePlugin.

## Known issues / open work

### Critical for next release

1. **pnpm 10 + Kuzu install**: `kuzu`'s postinstall script doesn't run under pnpm 10. Either move `kuzu` to `peerDependencies` + `peerDependenciesMeta: { kuzu: { optional: true } }` and lazy-import inside `KuzuModelRepository`, or document `pnpm approve-builds` in `storage-kuzu/README.md`.
2. **CLI / core dead deps**: `@braidhq/cli` declares but doesn't use `ink` / `react` / `@types/react` / `yaml` / `zod` / `@braidhq/core` / `@braidhq/schema` / `@hono/node-server`. `@braidhq/core` declares but doesn't use `neo4j-driver` / `simple-git` / `pino`. Trim.

### Phase 4+ (when the use case shows up)

3. **`@braidhq/storage-neo4j`**: First external proof that the Model-A refactor pays off. Implement `StoragePlugin`, drop in via `extraStoragePlugins`, demonstrate ontology + agent work unchanged. Architecture is in place; just needs the adapter code + a Cypher mapping for the 12-variant GraphOperation.
4. **`@braidhq/storage-kuzu` Cypher push-down**: today `applyNodeFilter` / `applyEdgeFilter` load the full snapshot and filter in JS. Acceptable for small graphs, becomes a problem fast. Push filters down to Cypher.
5. **PluginLoader runtime** (TODO Theme 7): `workspace/plugins/*.ts` should be loaded dynamically so workspace-local Tier-C plugins work without npm publishing. `@braidhq/sdk` is in place; just needs the loader.
6. **Tauri shell** (TODO Theme 9): `packages/desktop/src/index.ts` is `export {}`. Phase 6 of the proposal.
7. **`@braidhq/server-defaults` split**: Architectural ideal is `@braidhq/server` having zero plugin deps; defaults bundle lives in a separate package or subpath export with optional peerDeps. Deferred — pragmatically the two `composeApp` / `composeFsApp` entries already give the API surface; install-footprint surgery costs more than the current upside.

### Should-fix before going more public

8. **Studio UI test coverage**: 4 test files cover lib utilities + SkillTranscript. Wizard / Graph canvas / Proposal review have zero UI tests. Add Testing Library smoke tests for the golden paths.
9. **Validator coverage gap**: framework invariants and ontology-bundled validators are covered, but there's no test for the "switch ontology → validators switch" path. The e2e test pins the ddd happy path; would be nice to add a c4 mock that runs alongside.
10. **`SubprocessSkillRunner` 334 LOC**: still the biggest file. Already split out `subprocessEventStream`; further splits would target the session-dir/symlink logic and the queue/drain coordination.
11. **`composeFsApp` 174 LOC + inline OAuth callback**: extract `buildGoogleDriveLoader(secretStore, oauth)` helper before adding more plugins.

### Nice-to-have

12. **Drop `as never`-style brand casts** in plugin packages (e.g. `'gdrive' as LoaderKind`). Move to `LoaderKindSchema.parse(...)` — refactor B5 set the precedent in studio + server.
13. **CLI `VERSION = '0.0.0'`** hard-coded in `cli/src/main.ts`. Read from package.json.
14. **Structured logging**: `@braidhq/core` declares `pino` but uses it nowhere. Either wire it or drop the dep.
15. **`KuzuModelRepository.shallowEqual = JSON.stringify(a) === JSON.stringify(b)`**: object-key-order sensitive. Replace with a deep equality helper, or pin construction order.

## Where to start when you pick this up

Read `docs/PACKAGES.md` first if you're new — it's the most current architecture doc and answers "where does X go" for every common change. After that:

- Owner-facing question ("should this be its own package?") → `docs/PACKAGES.md` §6.
- Plugin-author question ("how do I add a new ontology?") → `docs/PACKAGES.md` §10.
- Domain-level question ("how does HITL apply work?") → `docs/ARCHITECTURE.md`.
- v1 thesis / scope rationale → `docs/OSS-PROPOSAL.md` (Chinese).

When you make non-trivial changes, run `pnpm -r typecheck && pnpm -r test` from the repo root before committing.
