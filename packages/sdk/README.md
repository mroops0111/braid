# @braidhq/sdk

Braid keeps a product's intent and its code aligned in one knowledge graph, and lets plugins extend every axis of that graph. `@braidhq/sdk` is the authoring surface for those plugins. Each `define*Plugin` factory takes a declarative spec and returns a frozen, validated plugin that core's registry can load, so an author declares what a plugin is without wiring the framework's ports by hand.

## Role

The SDK is the seam between core's ports and the packages that implement them. It turns a plain spec into a valid plugin, and fails at the author's own source line when the spec is wrong.

- **The Factories**: Five `define*Plugin` builders, one per extension axis: ontology, source loader, storage, view generator, and agent.
- **The Guardrails**: Builder-time shape checks, so a bad spec throws at the plugin's source line, not later from inside the registry.
- **The Config Contract**: Each factory parses the caller's config against its zod schema before invoking an author callback, so plugin bodies receive a typed config and never parse it themselves.

## Structure

The package is flat. Every module sits directly under `src/` and re-exports through the `index.ts` barrel.

```
src/
├── defineOntologyPlugin.ts
├── defineSourceLoaderPlugin.ts
├── defineStoragePlugin.ts
├── defineViewGeneratorPlugin.ts
├── defineAgentPlugin.ts
├── validation.ts
├── types.ts
└── index.ts
```

- **define\*Plugin**: One factory per extension axis, each a pure function from a spec to a frozen plugin.
- **validation**: The builder-time assertions the factories share, such as duplicate ids, unresolved edge endpoints, and CSS colour strings.
- **types**: The `PluginSkillRef` and `PluginReferenceDirRef` shapes a plugin uses to ship skills and reference directories alongside itself.

## Factories

Each factory maps a declarative spec to one plugin type on a distinct axis. All five share the same contract, they validate the spec when you call them, parse config before your callbacks run, and return a frozen plugin.

- **`defineOntologyPlugin`**: Node and edge types, validators, and the skills bundled with a domain. Composes over a base via `extends`, auto-attaches the type and structural validators, and defaults the skill namespace to the ontology id. Id `ontology.<ontologyId>`.
- **`defineSourceLoaderPlugin`**: How a source kind provisions and syncs its content into a workspace, plus an optional webhook capability. Id `source-loader.<kind>`.
- **`defineStoragePlugin`**: How a storage kind builds its per-process `ModelRepository`. Id `storage.<kind>`.
- **`defineViewGeneratorPlugin`**: How a view kind renders a model snapshot into an artifact. Id `view-generator.<viewKind>`.
- **`defineAgentPlugin`**: How an agent kind constructs its runtime binding. The binding is built synchronously because the subprocess spawn is lazy. Id `agent.<kind>`.

## Boundaries

These are the rules that keep the SDK a thin authoring layer. They are enforced in review.

- **Authoring Only**: The SDK builds and validates plugin objects. It never registers, spawns, or runs them, that is core and server.
- **Fail Early, Fail Local**: Invariants core would reject at registration are checked here first, so the stack trace points at the author's spec rather than a later registry call.
- **Frozen Output**: Every factory returns an `Object.freeze`d plugin, so a registered plugin cannot be mutated after the fact.
- **Config Before Callback**: An author callback never sees raw config. The wrapper parses first, so zod defaults and transforms reach the body in post-parse form.
- **Schema Is Upstream**: The SDK re-exports branded id helpers from schema for convenience, but declares no data shapes of its own.

## Dependencies

The SDK sits above core and schema and beneath the plugin packages that call it.

- **Depends On**: `@braidhq/core` for the port and plugin types, `@braidhq/schema` for branded ids, and `zod`.
- **Consumed By**: Every plugin package, such as `ontology-ddd`, `storage-kuzu`, `agent-claude-code`, and `source-loader-*`.
