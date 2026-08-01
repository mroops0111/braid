---
name: reconcile
description: Build cross-source graph structure (bridge edges, missing containment) and validate the graph globally. Emit a Proposal JSON when fixes / additions are needed. Read-only when run with the `validate` argument.
argument-hint: "[scope-hint | validate]"
disable-model-invocation: true
braid:
  category: build
  order: 300
  summary: Cross-link sources and validate the graph globally
  required-env: [BRAID_API_URL, BRAID_WORKSPACE, BRAID_WORKSPACE_ID]
  inputs:
    - name: mode
      label: Mode
      kind: pick
      provider:
        kind: static
        options:
          - value: ""
            label: Build + Validate
            description: Add missing edges and run all validators.
          - value: validate
            label: Validate Only
            description: Skip the build pass; report on the graph as-is.
      default: ""
    - name: scope
      label: Scope
      description: Bounded context to focus on. Leave empty for a full-graph pass.
      kind: pick
      optional: true
      provider:
        kind: graph-node
        filter:
          types: [boundedContext]
      fallback: text
---

## Role

You are the graph's global structurer and validator. Where `ddd:extract` sees a single intent / code slice at a time, you see the whole graph. Two jobs:

1. **Build**: create structural relationships extract can't infer because they require a cross-source view (containment, bridge edges between aggregates / contexts, cross-PRD triggers).
2. **Validate**: cross-check the assembled graph against the active ontology's structural rules and the per-node completeness rules.

The skill talks to the workspace through the `braid-core` MCP server (read capabilities: ontology fetch, model snapshot, node search; write capabilities: proposal submission, clarify-ticket submission). Discover the actual tool names via the MCP tool list before authoring calls; the capabilities below are *what to do*, not literal identifiers.

You never write to the graph directly. You produce a Proposal the human applies via Studio. When the right answer is ambiguous, you produce a ClarifyTicket instead.

This skill is shipped by the DDD ontology plugin (`@braidhq/ontology-ddd`). Its build phase encodes DDD-specific structural rules; workspaces using a different ontology should not load this skill.

## Design Principles

- Global view. `ddd:extract` sees one slice; you see the whole graph. Use that to spot wrong attachments and missing bridges.
- Validate before propose. Surface problems with sufficient context (which nodes, which rule). Don't dump raw API output.
- Conservative on semantics. Format fixes (casing, whitespace) are auto. Semantic decisions (which aggregate owns this command) become a ClarifyTicket.
- Idempotent. A `validate` run with no graph changes since last time must produce a no-op proposal (or none at all).

## Modes

| Argument | Mode | Behaviour |
|---|---|---|
| empty or `<scope-hint>` | **build + validate** | Add missing bridge / containment edges, then run all validations |
| `validate` | **validate only** | Skip building; report on the graph as-is |

`<scope-hint>` is a bounded-context id (e.g. `checkout`) that limits the work to nodes inside that context and their immediate neighbours.

## Initialization

1. Read `$BRAID_WORKSPACE/PRODUCT.md` to learn the active `ontologyId`.
2. Run `pwd` to capture your working directory. Companion docs (§ Companion Docs) live at `<cwd>/.claude/skills/shared/`; concatenate when you Read them.
3. Fetch the active ontology via `braid-core` so every type id you reference is canonical. Every `node.type` / `edge.type` you emit MUST equal one of the ids the ontology declares. Case-sensitive.
4. Fetch the model snapshot via `braid-core`, then run two node-search calls filtering by `status: 'draft'` and `status: 'unclear'` to enumerate work-in-progress nodes for validation.
5. Parse `$ARGUMENTS` (scope-hint / `validate` / empty) and pick the mode.
6. Check `$BRAID_CHANGED_UNITS` (optional, newline-separated `<sourceId>::<path>` entries set by BatchService or Reactor). When present, prioritise the build pass around the listed units (bridges, containment, drift involving any of their nodes); when absent, walk the whole graph as before. The validate pass always covers the full graph regardless of this hint.

## Procedure

Build mode runs Steps 1-3 (graph mutations + cross-source drift), then Steps 4-6 (validation). `validate` mode skips to Step 4. Step 7 always emits the proposal; Step 8 emits any clarify tickets.

### Step 1: Fix Wrong Edges Extract Emitted (build)

Each extract run sees one slice. From the global view, some edges land on the wrong target. Walk the graph and flag:

| Symptom | Action |
|---|---|
| Command attached to the wrong aggregate (a more specific aggregate exists) | Delete the old edge + create the new one in the proposal |
| Duplicate edges across slices (same `from` / `to` / `type`) | Delete the duplicate |
| Inconsistent attachments (same node, different parent in two slices) | ClarifyTicket: which parent is canonical? |
| `contains` edge from BoundedContext to a non-aggregate (cmd / qry / evt / rule) | Delete the edge. If the dangling node has no `accepts` / `emits` / `constrainedBy` to its owning aggregate, raise a ClarifyTicket asking which aggregate owns it. Do not re-attach to the BC. |
| `dependsOn` edge whose endpoints are not both aggregates | Delete and re-express. Use `triggers` for event-driven cross-aggregate flow; for direct read access, the calling aggregate should reference the target aggregate's id and use `dependsOn` between the two aggregates. |
| Command or query with no `performedBy` edge to any actor | For each command and query, check sibling commands on the same aggregate: if the aggregate's other operations have `performedBy` edges to a consistent actor set, propose the same wiring for the gap and add a one-line rationale. If sibling coverage is inconsistent or absent, raise a ClarifyTicket asking which actor performs the operation. Single-aggregate orphans without sibling coverage are the most common gap from per-slice extracts. |
| Aggregate with commands but no events, or events with no source command / aggregate | Cross-check the source references on the aggregate. If sibling commands emit events of a consistent shape (e.g. `*Created`, `*Updated`, `*Deleted`) but one command is missing its event, raise a ClarifyTicket asking whether the missing event was intentionally omitted (intermediate state change with no domain significance) or simply not extracted. |

### Step 2: Add Missing Containment (build)

For every aggregate without a `contains`-style edge from a context, decide its owning bounded context based on naming + cross-edges to peers. Create the missing edge in the proposal. If two contexts are plausible, raise a ClarifyTicket instead.

Only aggregates carry `contains` from a BoundedContext. Commands / queries / events / rules already have their parent aggregate via `accepts` / `emits` / `constrainedBy`; never add a `contains` edge from BC to them.

### Step 3: Add Bridge Edges + Cross-Source Drift (build)

Add `triggers`, `dependsOn`, `policy` chains, and aggregate-wide `constrainedBy` edges per concept.md's wiring rules. Context Mapping edges (the 7 strategic relationships) are never auto-emitted; raise a ClarifyTicket.

`ddd:extract` checks drift on a single slice at a time. From the global view, also catch:

| Drift shape | What to look for |
|---|---|
| **intent vs intent** | Same concept described in two intent files with different limits / states / rules |
| **code vs code** | A node's code refs include layers that disagree (backend vs frontend; controller vs service) |
| **intent vs code: cross-aggregate** | Intent describes a flow crossing two aggregates; code implements only one side |

For each finding, emit one `DriftIssue` per dimension and attach to the node's `metadata.driftIssues[]` via `updateNode`. `severity: 'error'` for contradictions, `warning` for gaps. Set `status: 'unclear'` on the patch when raising an `error` drift on a `draft` node.

### Step 4: Structural Validation

Structural violations show up in the `issues[]` array of Step 7's proposal-create response. Fix `error`-severity ones (or raise a ClarifyTicket if the right fix is ambiguous); report `warning`-severity in the proposal `rationale`. If a scope-hint is set, filter to nodes in or adjacent to that scope.

### Step 5: Node-Content Validation

For each `draft` or `unclear` node, check the per-type rules the ontology declares (required attributes, description shape). Promote `draft` to `completed` only when every required field is filled. Schema constraints are enforced server-side on apply; a status flip without filled fields fails with `BRAID-VAL`.

### Step 6: Coverage Scan + Stale Drift Cleanup

For each node with a source `ref`, scan for known coverage gaps the ontology cares about (e.g. error paths in commands, UI coverage of user-facing commands). Mark each `clear` / `partial` / `missing` in the proposal `rationale`. Don't try to fix coverage gaps; surface them for the next extract cycle. In `validate` mode also re-walk existing `metadata.driftIssues[]` and prune entries that no longer reproduce (replace the array via `updateNode`); never touch `metadata.acknowledgedDrifts`, which is human-set.

### Step 7: Emit the Proposal

Submit the Proposal via the `braid-core` proposal-create capability:

- `operations`: the bridge / containment / DriftIssue / status-flip ops you derived in Steps 1–6.
- `generatedBy`: `"ddd:reconcile"`.
- `rationale`: `"global structure pass + validation: <one-line summary of bridges added, drift attached, content fills>"`.

Operation names and payload shapes are in `.claude/skills/shared/proposal-format.md` (see § Companion Docs). Follow that file rather than freelancing JSON.

#### Step 8: Emit ClarifyTickets

For ambiguous attachments / splits / merges, submit a ClarifyTicket via the `braid-core` clarify-create capability per unresolved question. Include each candidate resolution with the evidence behind it so the human can pick informedly.

Before writing the `question` and each `candidate.description`, re-read `<cwd>/.claude/skills/ontology-ddd/concept.md` § ClarifyTickets: Reviewer Pool and Vocabulary. The reviewer pool for DDD workspaces is the cross-functional team (PM, RD, QA, designer); the ticket fields must read in their ubiquitous language, not in graph topology or code identifiers. Lower graph terms, exact node ids, and the engineering reasoning into the ticket's `context` field instead, which has no audience constraint.

## Output

stdout summary at the end:

```
ddd:reconcile (build + validate): proposal p-2026-05-12-abc (18 ops; 4 bridges, 5 driftIssues, 9 content fills)
ddd:reconcile raised 2 clarify tickets (ct-..., ct-...)
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

Companion docs sit at `<cwd>/.claude/skills/shared/` (core) and `<cwd>/.claude/skills/ontology-ddd/` (this plugin), where `<cwd>` is the value captured in Initialization step 2.

| File | When to read | Why |
|---|---|---|
| `.claude/skills/ontology-ddd/concept.md` | **Before Steps 1-3 and any time you author a bridge edge** | The DDD vocabulary, wiring rules, policy pattern, Context Mapping rules. Anchors every structural decision Part 1 makes. |
| `.claude/skills/shared/proposal-format.md` | Before Step 7 | `GraphOperation` discriminated union, `DriftIssue` shape, status semantics. |
| `.claude/skills/shared/clarify-format.md` | Before Step 8 | `ClarifyTicket` request body and candidate shape. |
| `.claude/skills/shared/content-conventions.md` | Whenever writing a `name`, `description`, `rationale`, or `question` | Plain-text rule, length caps, structural conventions for every user-facing string field. |
| `.claude/skills/shared/validators.md` | Before Step 7 | The four server-side validators; self-check ops here so they don't hit a 400 unnecessarily. |
| `.claude/skills/shared/drift-detection.md` | Step 3 | Dimension checklist + description pattern for `DriftIssue` entries; severity rules. |

## Notes

- If `$BRAID_WORKSPACE/skill-extensions/ddd-reconcile/EXTEND.md` exists, follow its rules after the steps above. Workspace-specific overrides (custom rules, ontology hints) belong there.
