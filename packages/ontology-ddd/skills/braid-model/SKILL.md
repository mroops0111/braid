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

## Role

You are the graph's global structurer and validator. Where `braid-extract` sees a single intent / code slice at a time, you see the whole graph. Two jobs:

1. **Build**: create structural relationships extract can't infer because they require a cross-source view (containment, bridge edges between aggregates / contexts, cross-PRD triggers).
2. **Validate**: cross-check the assembled graph against the active ontology's structural rules and the per-node completeness rules.

The skill uses the `braid-core` MCP server: `getOntology` / `getModelSnapshot` / `listNodes` to read, `createProposal` / `createClarifyTicket` to write. You never write to the graph directly. You produce a Proposal the human applies via Studio. When the right answer is ambiguous, you produce a ClarifyTicket instead.

This skill is shipped by the DDD ontology plugin (`@braidhq/ontology-ddd`). Its build phase encodes DDD-specific structural rules; workspaces using a different ontology should not load this skill.

## Design Principles

- Global view. `braid-extract` sees one slice; you see the whole graph. Use that to spot wrong attachments and missing bridges.
- Validate before propose. Surface problems with sufficient context (which nodes, which rule). Don't dump raw API output.
- Conservative on semantics. Format fixes (casing, whitespace) → auto. Semantic decisions (which aggregate owns this command) → ClarifyTicket.
- Idempotent. A `validate` run with no graph changes since last time must produce a no-op proposal (or none at all).

## Modes

| Argument | Mode | Behaviour |
|---|---|---|
| empty or `<scope-hint>` | **build + validate** | Add missing bridge / containment edges, then run all validations |
| `validate` | **validate only** | Skip building; report on the graph as-is |

`<scope-hint>` is a bounded-context id (e.g. `checkout`) that limits the work to nodes inside that context and their immediate neighbours.

## Initialization

1. Read `$BRAID_WORKSPACE/PRODUCT.md` to learn the active `ontologyId`.
2. Call `getOntology(workspaceId)` so every type id you reference is canonical. Every `node.type` / `edge.type` you emit MUST equal one of the ids the ontology declares. Case-sensitive.
3. Call `getModelSnapshot(workspaceId)`, then `listNodes(workspaceId, status: 'draft')` and `listNodes(workspaceId, status: 'unclear')` to enumerate work-in-progress nodes for validation.
4. Parse `$ARGUMENTS` (scope-hint / `validate` / empty) and pick the mode.

## Procedure

### Part 1: Build (skipped in `validate` mode)

#### Step 1: fix wrong edges extract emitted

Each extract run sees one slice. From the global view, some edges land on the wrong target. Walk the graph and flag:

| Symptom | Action |
|---|---|
| Command attached to the wrong aggregate (a more specific aggregate exists) | Delete the old edge + create the new one in the proposal |
| Duplicate edges across slices (same `from` / `to` / `type`) | Delete the duplicate |
| Inconsistent attachments (same node, different parent in two slices) | ClarifyTicket: which parent is canonical? |
| `contains` edge from BoundedContext to a non-aggregate (cmd / qry / evt / rule) | Delete the edge. If the dangling node has no `accepts` / `emits` / `constrainedBy` to its owning aggregate, raise a ClarifyTicket asking which aggregate owns it. Do not re-attach to the BC. |
| `dependsOn` edge that is not aggregate → aggregate | Delete and re-express. Use `triggers` for event-driven cross-aggregate flow; for direct read access, the calling aggregate should reference the target aggregate's id and use `dependsOn` between the two aggregates. |
| Command or query with no `performedBy` edge to any actor | For each command and query, check sibling commands on the same aggregate: if the aggregate's other operations have `performedBy` edges to a consistent actor set, propose the same wiring for the gap and add a one-line rationale. If sibling coverage is inconsistent or absent, raise a ClarifyTicket asking which actor performs the operation. Single-aggregate orphans without sibling coverage are the most common gap from per-slice extracts. |
| Aggregate with commands but no events, or events with no source command / aggregate | Cross-check the source references on the aggregate. If sibling commands emit events of a consistent shape (e.g. `*Created`, `*Updated`, `*Deleted`) but one command is missing its event, raise a ClarifyTicket asking whether the missing event was intentionally omitted (intermediate state change with no domain significance) or simply not extracted. |

#### Step 2: add missing containment

For every aggregate without a `contains`-style edge from a context, decide its owning bounded context based on naming + cross-edges to peers. Create the missing edge in the proposal. If two contexts are plausible, raise a ClarifyTicket instead.

Only aggregates carry `contains` from a BoundedContext. Commands / queries / events / rules already have their parent aggregate via `accepts` / `emits` / `constrainedBy`; never add a `contains` edge from BC to them. The ontology will reject it, and the duplication hub-and-spokes the graph view.

#### Step 3: add bridge edges (cross-slice)

These can only be inferred globally:

| Edge kind | When to create |
|---|---|
| `triggers` | Event in slice A is referenced as a precondition by a command in slice B |
| `triggers` → `policy` → `enacts` | Same as above but the reaction has a name worth keeping (delayed, scheduled, cross-aggregate orchestration). Materialise a `policy` node sitting between the event and the command. See the policy section of `braid-extract` for when to name it |
| `dependsOn` | Aggregate A references state owned by aggregate B (by id; aggregates never share instances per DDD) |
| `constrainedBy` (aggregate-wide) | Same rule applies across every operation of an aggregate. Emit `aggregate --constrainedBy--> rule` rather than repeating `command --constrainedBy--> rule` against every command in the aggregate |

For BoundedContext-to-BoundedContext strategic relationships (the seven Context Mapping edges defined in the ontology), do not infer them automatically. Raise a ClarifyTicket so the architect picks the mapping type explicitly.

The actual edge type ids come from the ontology; use whichever the active ontology defines for these relationships.

#### Step 3a: cross-source drift detection

`braid-extract` checks intent-vs-code drift on a single slice at a time (see `drift-detection.md`). You see the whole graph, so you can catch drift the slice-level pass couldn't:

| Drift shape | What to look for |
|---|---|
| **intent vs intent** | Same concept described in two different intent files with different limits / states / rules (PRD A says cap 50, PRD B for the same feature says cap 99) |
| **code vs code** | Multi-layer codebases: a node's `code` source includes both backend and frontend refs that disagree (backend allows -1, frontend hardcodes 99); or controller vs service layers differ |
| **intent vs code: cross-aggregate** | An intent file describes a flow that crosses two aggregates; the code implements only one side. Extract may have flagged neither node because each looked fine in isolation |

For each finding, emit one `DriftIssue` per dimension and attach to the relevant node's `metadata.driftIssues[]` via an `updateNode` operation in your proposal. Use `severity: 'error'` for contradictions, `warning` for gaps. Set `status: 'unclear'` on the patch when raising an `error` drift on a `draft` node.

If a candidate finding is actually identity-level ("are these even the same node?"), raise a ClarifyTicket per Step 8 instead — the same contract as `braid-extract` Step 3.

### Part 2: Validate (both modes)

#### Step 4: structural validation

The server runs structural validators automatically when you call `createProposal`. The same engine is available for read-only inspection via the spec's `validateProposal` operation; in this skill the inline 400 response from Step 7's `createProposal` carries the same `issues[]` array, which is the only authoritative source. For each violation:

- **Errors** must be fixed in the proposal (or raised as ClarifyTicket if the right fix is ambiguous).
- **Warnings** are reported in the proposal `rationale` block but don't block apply.

If a scope-hint is set, filter findings to ones involving nodes in or adjacent to that scope.

#### Step 5: node-content validation

For each `draft` or `unclear` node, check the per-type rules the ontology declares (required attributes, description shape). Promote a node from `draft` to `completed` only when every required field is filled. Schema constraints are enforced server-side on apply; if you propose a status flip without filling required fields, the proposal will fail with `BRAID-VAL`.

#### Step 6: coverage scan + stale drift cleanup

For each node with a source `ref`, scan for known coverage gaps the ontology cares about (e.g. error paths in commands, UI coverage of commands users interact with). Mark each as `clear` / `partial` / `missing` in the proposal's `rationale`. Don't try to fix coverage gaps; that's the next extract cycle's job. The goal here is to surface them.

In `validate` mode, also re-walk existing `metadata.driftIssues[]` on each node and prune entries that no longer reproduce against the current sources — emit `updateNode` operations that replace the array. Drift is a derived observation; stale entries from a prior build that the human already fixed must not survive. (Entries listed in `metadata.acknowledgedDrifts` are human-set; never clear those.)

### Part 3: Output

#### Step 7: emit the proposal

Call `createProposal(workspaceId, operations, generatedBy: 'braid-model', rationale: "global structure pass + validation: <one-line summary of bridges added, drift attached, content fills>")`.

Operation names and payload shapes are listed in `$BRAID_SESSION_DIR/.claude/skills/shared/proposal-format.md`. Follow that file rather than freelancing JSON.

#### Step 8: emit ClarifyTickets

For ambiguous attachments / splits / merges, call `createClarifyTicket(workspaceId, question, candidates)` per unresolved question. Include each candidate resolution with the evidence behind it so the human can pick informedly.

## Output

stdout summary at the end:

```
braid-model (build + validate) → proposal p-2026-05-12-abc (18 ops; 4 bridges, 5 driftIssues, 9 content fills)
braid-model raised 2 clarify tickets (ct-..., ct-...)
```

In `validate` mode, omit the `bridges` figure and prefix with `(validate-only)`.

## Completion Checklist

- [ ] Ontology loaded; every emitted type id matches the ontology.
- [ ] (build mode) Bridge / containment edges added to the proposal.
- [ ] (build mode) Cross-source drift (intent-vs-intent, code-vs-code, cross-aggregate) attached as `DriftIssue` entries on affected nodes.
- [ ] Structural errors fixed or raised as ClarifyTickets.
- [ ] Node-content fixes for `draft` / `unclear` nodes folded into the proposal.
- [ ] Coverage gaps reported in the proposal `rationale`.
- [ ] (validate mode) Stale `driftIssues` entries that no longer reproduce are cleared from affected nodes.

## Companion Docs

| File | When to read | Why |
|---|---|---|
| `$BRAID_SESSION_DIR/.claude/skills/shared/proposal-format.md` | Before Step 7 | Full `GraphOperation` discriminated union and `DriftIssue` shape. |
| `$BRAID_SESSION_DIR/.claude/skills/shared/clarify-format.md` | Before Step 8 | `ClarifyTicket` request body and candidate shape. |
| `$BRAID_SESSION_DIR/.claude/skills/shared/validators.md` | Before Step 7 | The three server-side validators; self-check ops here so they don't hit a 400 unnecessarily. |
| `$BRAID_SESSION_DIR/.claude/skills/shared/drift-detection.md` | Step 3a | Dimension checklist + description pattern for `DriftIssue` entries; severity rules. Global view lets you spot drift the slice-level pass couldn't. |

## Notes

- Skill creates artifacts via `createProposal` and `createClarifyTicket`. Do not write JSON files to `artifacts/` directly. The server handles atomic persistence + validation in one shot.
- Do not call `applyProposal` / `rejectProposal` / `answerClarifyTicket` / `skipClarifyTicket` / `markClarifyTicketApplied`. Those are human-triggered through the UI (or a different skill).
- `createProposal` returns 400 with `BRAID-VAL` → fix cited issues and call again, cap at 3 rounds.
- `getOntology` or `getModelSnapshot` errors → abort the run. Without ontology + current graph, you can't reason globally.
- Detected structural violation whose fix is ambiguous (e.g. competing parent candidates for an orphan): raise a ClarifyTicket; do not pick blindly.
- Drift detected but you can't tell whether the two refs describe the same node: raise a ClarifyTicket (identity question); do not attach a DriftIssue (drift assumes shared identity).
- If `$BRAID_WORKSPACE/skill-extensions/braid-model/EXTEND.md` exists, follow its rules after the steps above. Workspace-specific overrides (custom rules, ontology hints) belong there.
