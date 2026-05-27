# Server-Side Validators

The server runs four validators on every proposal submission (and on Apply). If any reports a `severity: 'error'` issue, the call returns `400` with a `code: BRAID-VAL` body and an `issues[]` array naming each violation. `warning` issues don't block apply but do appear on the proposal review pane.

Reading this doc lets a skill self-check its operations before POSTing, avoiding round-trips on issues the LLM can spot locally.

Validator source: `packages/core/src/infrastructure/validation/`.

## 1. OntologyTypeValidator

**What it checks.** Every `node.type` is in the active ontology's `nodeTypes[].id` set; every `edge.type` is in `edgeTypes[].id`. Case-sensitive.

**Codes emitted.**

| Code | When |
|---|---|
| `ontology.unknown-node-type` | A node carries a type not in the ontology |
| `ontology.unknown-edge-type` | An edge carries a type not in the ontology |

**How to self-check.** Fetch the ontology via `braid-core` once during Initialization; every emitted node/edge `type` must equal an `id` literally. Tempted to write `Context` or `CONTAINS`? Re-read the response. Type ids are lowercase camelCase like `boundedContext` and `contains`.

## 2. StructuralValidator

**What it checks.** For every edge in the proposal-applied snapshot:

- The edge's source node type is listed in `edgeTypes[<type>].fromTypes`.
- The edge's target node type is listed in `edgeTypes[<type>].toTypes`.
- The cardinality (`1:1` / `1:N` / `N:1` / `N:N`) is respected across the whole graph.

Reads cardinality "one-to-many" left-to-right: `1:N` means each target accepts at most one source, sources fan out without limit.

**Codes emitted.**

| Code | When |
|---|---|
| `structural.endpoint-type-from` | Edge source's node type isn't allowed by `edgeTypes[<type>].fromTypes` |
| `structural.endpoint-type-to` | Edge target's node type isn't allowed by `edgeTypes[<type>].toTypes` |
| `structural.cardinality-source` | A single source node exceeds the per-edge-type source-side cap |
| `structural.cardinality-target` | A single target node exceeds the per-edge-type target-side cap |

**How to self-check.** For every `addEdge` op you generate, walk to the source and target node (in the operations buffer + the model-snapshot baseline), look up the node's type, and assert membership in `fromTypes` / `toTypes`. For cardinality, count edges of each type that touch each node. Refuse to emit an op that pushes either side over the declared limit.

## 3. EvidenceValidator

**What it checks.** Every node carries an evidence trail:

- At least one `metadata.sourceReferences[]` entry, **OR**
- `metadata.implementationMissing: true` (intent-only, code not built yet), **OR**
- `metadata.intentMissing: true` (code-only, intent not written yet).

Also: a node with `status: 'completed'` must have at least one `sourceReferences` entry (completion is a claim of fact and requires a citation).

And: every `DriftIssue` attached to a node's `metadata.driftIssues[]` is surfaced as a `ValidationIssue` preserving its severity. An `error`-severity DriftIssue blocks Apply unless the human has added its `description` string to `metadata.acknowledgedDrifts[]` (humans write that field; skills do not).

**Codes emitted.**

| Code | When |
|---|---|
| `evidence.no-source-or-flag` | Node has no sources AND no `intentMissing`/`implementationMissing` flag |
| `evidence.completed-no-source` | Node is `status: completed` but `sourceReferences[]` is empty |
| `evidence.drift` | A DriftIssue on the node's metadata (severity passed through; `error` blocks apply) |

**How to self-check.** Treat `metadata` as required on every node you emit. If you have nothing, decide which flag applies (extract from code only → `intentMissing`; extract from PRD only → `implementationMissing`). Never emit empty `metadata`.

## 4. OrphanEdgeValidator

**What it checks.** Every edge's `fromNodeId` and `toNodeId` resolve to a node in the snapshot.

**Codes emitted.**

| Code | When |
|---|---|
| `edge.dangling-source` | Edge points at a `fromNodeId` that doesn't exist |
| `edge.dangling-target` | Edge points at a `toNodeId` that doesn't exist |

**How to self-check.** When emitting `addEdge`, the endpoints must either already exist in the model snapshot OR be `addNode`d earlier in the same `operations[]` array. Removing a node (`removeNode`) without first removing edges that touch it leaves orphans. Prefer `updateNode { status: 'deprecated' }` instead.

## Reading the 400 Response

```json
{
  "type": "about:blank",
  "title": "ValidationError",
  "status": 400,
  "code": "BRAID-VAL",
  "issues": [
    {
      "code": "structural.endpoint-type-from",
      "severity": "error",
      "message": "Edge ... has source node of type ...",
      "edgeId": "edge.checkout-cmd-cancel"
    }
  ]
}
```

Each issue carries an `nodeId` or `edgeId` pinning the offending artifact. Fix the cited issues and resend. Cap retries at **3 rounds**; after that, list remaining issues in stdout and stop.

## What's Not Enforced Server-Side

A few rules the SKILL.md files mention (e.g. "≤ 30 ops per proposal", "no Context Mapping edge auto-emitted") are skill-level conventions, not server validators. They live in the SKILL.md Completion Checklist; the server happily accepts violations.
