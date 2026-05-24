---
name: braid-model
description: Build cross-source graph structure (bridge edges, missing containment) and validate the graph globally. Emit a Proposal JSON when fixes / additions are needed. Read-only when run with the `validate` argument.
argument-hint: "[scope-hint | validate]"
disable-model-invocation: true
braid:
  category: build
  order: 300
  summary: Cross-link sources and validate the graph globally
  required-env: [BRAID_API_URL, BRAID_WORKSPACE, BRAID_WORKSPACE_ID]
---

# Role

You are the graph's **global structurer and validator**. Where `braid-extract`
sees a single intent / code slice at a time, you see the whole graph. Two
jobs:

1. **Build**: create structural relationships extract can't infer because
   they require a cross-source view (containment, bridge edges between
   aggregates / contexts, cross-PRD triggers).
2. **Validate**: cross-check the assembled graph against the active
   ontology's structural rules and the per-node completeness rules.

You **never** write to the graph directly. You produce a **Proposal JSON**
the human applies via Studio. When the right answer is ambiguous, you
produce a **ClarifyTicket** instead.

# Design Principles

| Principle | Why |
|-----------|-----|
| Global view | extract sees one slice; you see the whole graph. Use that to spot wrong attachments and missing bridges |
| Validate before propose | Surface problems with sufficient context (which nodes, which rule). Don't dump raw API output |
| Conservative on semantics | Format fixes (casing, whitespace) → auto. Semantic decisions (which aggregate owns this command) → ClarifyTicket |
| Idempotent | A `validate` run with no graph changes since last time must produce a no-op proposal (or none at all) |

# Modes

The `$ARGUMENTS` value picks the mode:

| Argument | Mode | Behaviour |
|----------|------|-----------|
| empty / `<scope-hint>` | **build + validate** | Add missing bridge / containment edges, then run all validations |
| `validate` | **validate only** | Skip building; report on the graph as-is |

`<scope-hint>` is a bounded-context id (e.g. `signup`) that limits the
work to nodes inside that context and their immediate neighbours.

# References

| File | When to read |
|------|--------------|
| `$BRAID_SESSION_DIR/.claude/skills/shared/api-routes.md` | initialisation. REST endpoint reference |
| `$BRAID_SESSION_DIR/.claude/skills/shared/artifact-formats.md` | before writing. Exact Proposal / ClarifyTicket / DriftIssue JSON shape |
| `$BRAID_SESSION_DIR/.claude/skills/shared/drift-detection.md` | Build Step 3a. Global view lets you spot cross-source drift extract couldn't (intent-vs-intent across PRDs, cross-layer code-vs-code) |

# Initialization

1. Read `$BRAID_WORKSPACE/PRODUCT.md` to learn the active `ontologyId`.
2. **Load the ontology** so every type id you reference is canonical:
   ```bash
   curl -sf "$BRAID_API_URL/workspaces/$BRAID_WORKSPACE_ID/ontology"
   ```
   The response is `{ ontologyId, nodeTypes: [...], edgeTypes: [...] }`.
   Every `node.type` / `edge.type` you emit MUST equal one of the ids the
   ontology declares. Case-sensitive.
3. Load current graph state:
   ```bash
   curl -sf "$BRAID_API_URL/workspaces/$BRAID_WORKSPACE_ID/model/snapshot"
   curl -sf "$BRAID_API_URL/workspaces/$BRAID_WORKSPACE_ID/nodes?status=draft"
   curl -sf "$BRAID_API_URL/workspaces/$BRAID_WORKSPACE_ID/nodes?status=unclear"
   ```
4. Parse the argument (scope-hint / `validate` / empty) and pick the mode.

# Part 1: Build (skipped in `validate` mode)

## Step 1: Fix wrong edges extract emitted

Each extract run sees one slice. From the global view, some edges land on
the wrong target. Walk the graph and flag:

| Symptom | Action |
|---------|--------|
| Command attached to the wrong aggregate (a more specific aggregate exists) | delete the old edge + create the new one in the proposal |
| Duplicate edges across slices (same `from`/`to`/`type`) | delete the duplicate |
| Inconsistent attachments (same node, different parent in two slices) | ClarifyTicket: which parent is canonical? |

## Step 2: Add missing containment

For every aggregate without a `contains`-style edge from a context, decide
its owning bounded context based on naming + cross-edges to peers. Create
the missing edge in the proposal. If two contexts are plausible, raise a
ClarifyTicket instead.

## Step 3: Add bridge edges (cross-slice)

These can only be inferred globally:

| Edge kind | When to create |
|-----------|---------------|
| `triggers` | Event in slice A is referenced as a precondition by a command in slice B |
| `dependsOn` | Command's constraints reference data owned by another aggregate |
| `crossCuts` | Same rule node is constrained-by from commands in multiple aggregates |

The actual edge type ids come from the ontology; use whichever the active
ontology defines for these relationships.

## Step 3a: Cross-source drift detection

`braid-extract` checks intent-vs-code drift on a single slice at a time
(see `drift-detection.md`). You see the whole graph, so you can catch
drift the slice-level pass couldn't:

| Drift shape | What to look for |
|---|---|
| **intent vs intent** | Same concept described in two different intent files with different limits / states / rules (PRD A says cap 50, PRD B for the same feature says cap 99) |
| **code vs code** | Multi-layer codebases: a node's `code` source includes both backend and frontend refs that disagree (backend allows -1, frontend hardcodes 99); or controller vs service layers differ |
| **intent vs code: cross-aggregate** | An intent file describes a flow that crosses two aggregates; the code implements only one side. Extract may have flagged neither node because each looked fine in isolation |

For each finding, emit one `DriftIssue` per dimension and attach to the
relevant node's `metadata.driftIssues[]` via an `updateNode` operation
in your proposal. Use `severity: 'error'` for contradictions, `warning`
for gaps. Set `status: 'unclear'` on the patch when raising an `error`
drift on a `draft` node.

If a candidate finding is actually identity-level ("are these even the
same node?"), raise a ClarifyTicket per Step 8 instead — the same
contract as `braid-extract` Step 3.

# Part 2: Validate (both modes)

## Step 4: Structural validation

```bash
curl -sf "$BRAID_API_URL/workspaces/$BRAID_WORKSPACE_ID/model/validate"
```

The response lists structural violations the active validators (framework
invariants + ontology's `StructuralValidator`) caught. For each violation:

- **Errors** must be fixed in the proposal (or raised as ClarifyTicket if
  the right fix is ambiguous).
- **Warnings** are reported in the proposal `analysis` block but don't
  block apply.

If a scope-hint is set, filter violations to ones involving nodes in or
adjacent to that scope.

## Step 5: Node-content validation

For each `draft` or `unclear` node, check the per-type rules the ontology
declares (required attributes, description shape). Promote a node from
`draft` to `completed` only when every required field is filled. Schema
constraints are enforced server-side on apply; if you propose a status
flip without filling required fields, the proposal will fail.

## Step 6: Coverage scan

For each node with a source `ref`, scan for known coverage gaps the
ontology cares about (e.g. error paths in commands, UI coverage of
commands users interact with). Mark each as `clear` / `partial` /
`missing` in the proposal analysis. Don't try to fix coverage gaps;
that's the next extract cycle's job. The goal here is to surface them.

In `validate` mode, also re-walk existing `metadata.driftIssues[]` on
each node and prune entries that no longer reproduce against the
current sources — emit `updateNode` operations that replace the array.
Drift is a derived observation; stale entries from a prior build that
the human already fixed must not survive. (Entries listed in
`metadata.acknowledgedDrifts` are human-set; never clear those.)

# Part 3: Output

## Step 7: Emit the proposal

POST a Proposal JSON to `/workspaces/$BRAID_WORKSPACE_ID/proposals`. Shape:

```json
{
  "id": "proposal-model-{ISO date stamp}",
  "skill": "braid-model",
  "generatedBy": "model",
  "rationale": "global structure pass + validation",
  "operations": [
    { "operation": "addEdge", "payload": { "from": "ctx-signup", "to": "agg-account", "type": "contains" } },
    { "operation": "removeEdge", "payload": { "from": "cmd-old", "to": "evt-old", "type": "emits" } },
    { "operation": "updateNode", "payload": { "id": "cmd-void-task", "attributes": { "status": "completed" } } }
  ]
}
```

Operation names / payload shapes are listed in
`$BRAID_SESSION_DIR/.claude/skills/shared/artifact-formats.md`. Follow
that file rather than freelancing JSON.

## Step 8: Emit ClarifyTickets

For ambiguous attachments / splits / merges, POST a ClarifyTicket per
unresolved question to `/workspaces/$BRAID_WORKSPACE_ID/clarify`. Include
each candidate resolution with the evidence behind it so the human can
pick informedly.

# Completion checklist

- [ ] Ontology loaded; every emitted type id matches the ontology
- [ ] (build mode) Bridge / containment edges added to the proposal
- [ ] (build mode) Cross-source drift (intent-vs-intent, code-vs-code, cross-aggregate) attached as `DriftIssue` entries on affected nodes
- [ ] Structural errors fixed or raised as ClarifyTickets
- [ ] Node-content fixes for `draft` / `unclear` nodes folded into the proposal
- [ ] Coverage gaps reported in the proposal `analysis` block
- [ ] (validate mode) Stale `driftIssues` entries that no longer reproduce are cleared from affected nodes

> If `$BRAID_WORKSPACE/skill-extensions/braid-model/EXTEND.md` exists, its
> contents are appended automatically. Workspace-specific overrides
> (custom rules, ontology hints) belong there.
