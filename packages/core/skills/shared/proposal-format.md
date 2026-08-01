# Proposal Format

What a skill puts on the wire for the `braid-core` proposal-create capability that the MCP tool schema can't describe on its own. The envelope shape (`operations`, `generatedBy`, `rationale`, `externalReferences`) is in the MCP tool's `inputSchema` and not repeated here. What this doc covers:

- The 12 `GraphOperation` variants the gateway flattens to `dict[str, Any]` in MCP.
- `NewGraphNode` / `NewGraphEdge` payload shapes (same reason).
- Status semantics on `node.status`.
- The < 30 ops per proposal rule.

For the `DriftIssue` shape on `node.metadata.driftIssues[]`, see `drift-detection.md`. For per-field content rules (description length, name format, rationale structure), see `content-conventions.md`. For per-ontology id prefix conventions and per-type description aspects, see the active ontology's `concept.md` (e.g. `<cwd>/.claude/skills/ontology-ddd/concept.md`). For the server-side validators that gate `createProposal`, see `validators.md`.

## GraphOperation (Discriminated Union on `operation`)

Each entry in `operations[]` is one of:

```json
{ "operation": "addNode", "payload": { /* NewGraphNode */ } }
{ "operation": "addNodes", "payloads": [ /* NewGraphNode[] */ ] }
{ "operation": "removeNode", "nodeId": "..." }
{ "operation": "removeNodes", "nodeIds": [ "...", "..." ] }
{ "operation": "updateNode", "nodeId": "...", "patch": { "status": "completed" } }
{ "operation": "updateNodes", "updates": [{ "nodeId": "...", "patch": {...} }] }
{ "operation": "addEdge", "payload": { /* NewGraphEdge */ } }
{ "operation": "addEdges", "payloads": [ /* NewGraphEdge[] */ ] }
{ "operation": "removeEdge", "edgeId": "..." }
{ "operation": "removeEdges", "edgeIds": [ "...", "..." ] }
{ "operation": "updateEdge", "edgeId": "...", "patch": { "type": "..." } }
{ "operation": "updateEdges", "updates": [{ "edgeId": "...", "patch": {...} }] }
```

`type` and `status` valid values come from the active ontology plugin. Pull the current set from the `braid-core` ontology-fetch capability. `OntologyTypeValidator` rejects any value that isn't there.

## NewGraphNode Payload

```jsonc
{
  "id": "cmd.cancelOrder",          // optional; skill mints by convention (see ontology's concept.md)
  "type": "command",                 // must match ontology nodeTypes[].id
  "name": "cancelOrder",             // see content-conventions.md
  "description": "...",              // see content-conventions.md + ontology concept.md
  "status": "draft",                 // default 'draft'; promote to 'completed' only when sources align
  "metadata": {                      // required object
    "sourceReferences": [
      { "sourceId": "src-intent", "location": { "uri": "...", "anchor": "..." } }
    ],
    "intentMissing": false,          // optional; true means "code exists, no spec yet"
    "implementationMissing": false,  // optional; true means "spec exists, no code yet"
    "driftIssues": [ /* DriftIssue[]; see drift-detection.md */ ]
  }
}
```

`EvidenceValidator` (in `validators.md`) requires *some* evidence: at least one `sourceReferences` entry, or `intentMissing: true`, or `implementationMissing: true`.

### Picking sourceReferences

A node usually has more than one place it could cite: an intent doc plus one or more code files (backend definition, frontend binding, ORM model, UI page, test fixture, etc.). All of them are valid evidence, but order matters.

**Lead with the most representative entry for this node's type** — the file that most directly *defines* or *invokes* the thing the node names. Then list supporting refs in decreasing specificity. For example:

- A node naming a **definition** (a type, a model, a schema, an invariant): lead with the file holding the canonical declaration; UI bindings, consumers, and prose mentions follow.
- A node naming an **action** or **moment** (a request that changes state, an event emitted, a reaction): lead with the entry point that handles or emits it; supporting layers (validators, UI dispatchers, downstream subscribers) follow.
- A node naming a **role**: lead with where the role's identity / scope is defined; the places it's consumed follow.

Intent vs code is **not** a fixed order. Lead with whichever genuinely defines the node today — a fresh PRD with no implementation leads with intent; long-running code with no spec leads with code; both-aligned cases lead with whichever is more concrete for that type. Apply the same principle inside one source kind too (e.g. backend handler before its tests; ORM model before its migrations).

The order is consumed by Studio's detail panel and `braid:generate-doc` as "the link a reader should click first." Drift detection treats every entry equally regardless of order.

## NewGraphEdge Payload

```jsonc
{
  "id": "edge.ctx-checkout-agg-order",  // optional; skill mints by convention
  "type": "contains",                    // must match ontology edgeTypes[].id
  "fromNodeId": "ctx.checkout",
  "toNodeId": "agg.order",
  "metadata": { "sourceReferences": [] }
}
```

`StructuralValidator` (in `validators.md`) enforces `fromNodeId`'s type ∈ `edgeTypes[<type>].fromTypes` and `toNodeId`'s likewise for `toTypes`.

## Status Semantics

- `draft`: extracted, not yet reviewed.
- `unclear`: at least one `error`-severity `DriftIssue` is attached.
- `completed`: human applied; sources align. Requires `sourceReferences` ≥ 1.
- `deprecated`: source removed but history kept. Use `updateNode { status: 'deprecated' }`; never `removeNode` for nodes that were once `completed`.

## Sizing

A proposal must carry **fewer than 30 operations**. If a slice produces more, split into multiple proposals. They share an `externalReferences` entry if they trace back to the same source.
