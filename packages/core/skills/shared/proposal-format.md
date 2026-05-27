# Proposal Format

The shape of the JSON the skill produces (server-mediated via the
`createProposal` MCP tool) and the `GraphOperation` discriminated
union it carries. For the `DriftIssue` shape that lives inside a
node's metadata, see `drift-detection.md`. For server-side validation
rules every Proposal goes through, see `validators.md`.

## Proposal

The server response (and on-disk shape):

```json
{
  "id": "p-2026-05-12-abc123",
  "workspaceId": "<workspace id>",
  "status": "pending",
  "operations": [ /* GraphOperation[] */ ],
  "generatedBy": "braid-extract",
  "generatedAt": "2026-05-12T14:23:00+08:00",
  "rationale": "One paragraph: why these ops, what triggered the proposal."
}
```

Request body passed to the `createProposal` MCP tool (same shape minus
the server-controlled fields `id`, `status`, `generatedAt`):

```json
{
  "operations": [ /* GraphOperation[] */ ],
  "generatedBy": "braid-extract",
  "rationale": "One paragraph: why these ops, what triggered the proposal.",
  "externalReferences": [{ "kind": "redmine", "url": "...", "label": "..." }]
}
```

Required on the request: `operations`, `generatedBy` (the skill id),
`rationale`. Optional: `externalReferences`
(`[{kind, url, label?}]`) for linking back to Redmine / Jira / XWiki
source tickets.

## GraphOperation (Discriminated Union on `operation`)

Each operation is one of:

```json
{ "operation": "addNode", "payload": { "type": "command", "name": "cancelOrder", "id": "cmd.cancelOrder" } }
{ "operation": "addNodes", "payloads": [ ...NewGraphNode ] }
{ "operation": "removeNode", "nodeId": "..." }
{ "operation": "removeNodes", "nodeIds": [ "...", "..." ] }
{ "operation": "updateNode", "nodeId": "...", "patch": { "status": "completed" } }
{ "operation": "updateNodes", "updates": [{ "nodeId": "...", "patch": {...} }] }
{ "operation": "addEdge", "payload": { "type": "contains", "fromNodeId": "ctx.x", "toNodeId": "agg.y" } }
{ "operation": "addEdges", "payloads": [ ...NewGraphEdge ] }
{ "operation": "removeEdge", "edgeId": "..." }
{ "operation": "removeEdges", "edgeIds": [ "...", "..." ] }
{ "operation": "updateEdge", "edgeId": "...", "patch": { "type": "..." } }
{ "operation": "updateEdges", "updates": [{ "edgeId": "...", "patch": {...} }] }
```

`type` and `status` valid values are defined by the active ontology
plugin. Pull the current set from `getOntology(workspaceId)`. The
server's `OntologyTypeValidator` rejects any type not in that list
(see `validators.md`).

## NewGraphNode Payload Shape

```jsonc
{
  "id": "cmd.cancelOrder",          // optional; server mints if absent (prefer skill-minted ids)
  "type": "command",                 // must match getOntology nodeTypes[].id
  "name": "cancelOrder",
  "description": "...",              // optional but recommended
  "status": "draft",                 // default 'draft'; promote to 'completed' only when sources align
  "metadata": {                      // required object (defaults provided server-side, but be explicit)
    "sourceReferences": [
      { "sourceId": "src-intent", "location": { "uri": "...", "anchor": "..." } }
    ],
    "intentMissing": false,          // optional; true means "code exists, no spec yet"
    "implementationMissing": false,  // optional; true means "spec exists, no code yet"
    "driftIssues": [ /* DriftIssue[] — see drift-detection.md */ ]
  }
}
```

`EvidenceValidator` (in `validators.md`) requires *some* evidence: at
least one `sourceReferences` entry, or `intentMissing: true`, or
`implementationMissing: true`.

## NewGraphEdge Payload Shape

```jsonc
{
  "id": "edge.ctx-checkout-agg-order",  // optional; server mints if absent
  "type": "contains",                   // must match getOntology edgeTypes[].id
  "fromNodeId": "ctx.checkout",
  "toNodeId": "agg.order",
  "metadata": {
    "sourceReferences": []              // edges can carry source citations too
  }
}
```

`StructuralValidator` (in `validators.md`) enforces that `fromNodeId`
points at a node whose `type` is listed in `edgeTypes[<type>].fromTypes`
and `toNodeId` likewise for `toTypes`.

## ID Generation

Node and edge IDs are minted **by the skill** following the
ontology-style dotted convention: `cmd.cancelOrder`, `ctx.checkout`,
`evt.OrderPlaced`, `edge.ctx-checkout-agg-order`. Don't pre-mint
proposal / clarify ticket IDs — the server mints those on POST.

Conventions worth following so reviewers can scan the operations list:

| Concept | Prefix |
|---|---|
| Bounded context | `ctx.` |
| Aggregate | `agg.` |
| Command | `cmd.` |
| Query | `qry.` |
| Event | `evt.` |
| Rule | `rule.` |
| Actor | `actor.` |
| Policy | `policy.` |
| Edge | `edge.` followed by a meaningful slug |

The shape of the id is a hint for humans; the contract is `type`.

## Status Semantics

- `draft`: extracted, not yet reviewed.
- `unclear`: at least one `error`-severity `DriftIssue` is attached.
- `completed`: human applied; sources align. Requires `sourceReferences` ≥ 1.
- `deprecated`: source removed but history kept. Use `updateNode { status: 'deprecated' }`, never `removeNode` for nodes that were once `completed`.

## Sizing

A proposal must carry **fewer than 30 operations**. If a slice produces
more, split into multiple proposals — they share an `externalReferences`
entry if they trace back to the same source.
