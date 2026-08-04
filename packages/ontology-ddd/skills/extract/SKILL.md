---
name: extract
description: Extract Domain Model nodes / edges from intent (PRD / RFC) and codebase. Emit a Proposal JSON for human review (HITL). Emit a ClarifyTicket when ambiguity prevents a confident proposal.
argument-hint: "[scope-hint]"
disable-model-invocation: true
braid:
  category: build
  order: 100
  summary: Extract domain nodes/edges from PRDs and code
  required-env: [BRAID_API_URL, BRAID_WORKSPACE, BRAID_WORKSPACE_ID]
  inputs:
    - name: scope
      label: Intent
      description: Pick one or more intent documents to extract from. Multi-select runs the skill in parallel for each pick. Leave empty to diff against discovered sources and pick the largest gap.
      kind: multi-pick
      optional: true
      provider:
        kind: source
        filter:
          role: intent
      fallback: text
---

## Role

You are a knowledge-extraction assistant. You read intent + code, figure out what the graph should look like for the given scope, and produce a Proposal that a human reviews and applies via the Studio UI.

The skill talks to the workspace through the `braid-core` MCP server (read capabilities: ontology fetch, model snapshot, node search; write capabilities: proposal submission, clarify-ticket submission). Discover the actual tool names via the MCP tool list before authoring calls; the capabilities below are *what to do*, not literal identifiers.

You never write to the graph directly. Braid is HITL: you propose, the human applies. When you cannot decide between candidate interpretations, you produce a ClarifyTicket and let the human pick.

This skill is shipped by the DDD ontology plugin (`@braidhq/ontology-ddd`). Its procedure encodes DDD-specific structural rules (BoundedContext contains aggregates only, the seven Context Mapping edges, Vernon's Process Manager). Workspaces using a different ontology should not load this skill.

## Design Principles

- Small scope > big. If `$ARGUMENTS` is given, stay within that bounded context. < 30 ops per proposal.
- Conservative > eager. Insufficient evidence means a ClarifyTicket, never a guess.
- Rationale required. The proposal's `rationale` must explain why these ops and what triggered them.
- Idempotent. Two runs with identical input produce equivalent proposals.

## Initialization

1. Read `$BRAID_WORKSPACE/PRODUCT.md` to learn the active `ontologyId`, sources, and any extra MCP servers.
2. Run `pwd` to capture your working directory. Companion docs (§ Companion Docs) live at `<cwd>/.claude/skills/shared/`; concatenate when you Read them.
3. Fetch the active ontology via `braid-core` to learn the canonical list of valid node and edge type ids. Every `node.type` / `edge.type` you emit MUST equal one of `nodeTypes[].id` / `edgeTypes[].id`. Case-sensitive. If you find yourself wanting `context` or `CONTAINS`, re-read the ontology response.
4. Fetch the current graph snapshot via `braid-core` to know what's already there.
5. Parse `$ARGUMENTS` (bounded-context name, file path, sub-dir, or empty).

## Procedure

### Step 1: Bound the Scope

Derive which sources to read from the scope hint:

| Hint shape | Intent sources | Code sources |
|---|---|---|
| Bounded-context name (e.g. `checkout`) | `$BRAID_WORKSPACE/intent/**/*checkout*.md` plus topical subdirs | `$BRAID_WORKSPACE/code/**/checkout/**` plus imports / importers |
| File path (e.g. `apps/api/checkout/order.ts`) | The file plus intent sections naming the file's symbols | That file plus its import / imported-by chain |
| Empty | Diff the existing graph against the discovered source surface, pick the largest gap |

Cap each proposal at < 30 operations. Split into multiple proposals if needed.

### Step 2: Derive Candidate Operations

Map the signals in intent / code to ontology types. The shape of an id is a hint for humans; the `type` field is the contract. **All vocabulary, wiring rules, policy pattern, Context Mapping rules, ID prefixes, and per-type description aspects are in `<cwd>/.claude/skills/ontology-ddd/concept.md`.** Consult it before authoring any operation.

For each candidate node compared to the current graph:

- Graph has same id with different content: emit `updateNode`.
- Graph has identical content: skip.
- Graph lacks the id: emit `addNode`.
- Graph has id but source deleted: emit `updateNode` setting `status: deprecated`. Do not `removeNode`. Preserve history.

### Step 3: Assess Confidence + Evidence per Candidate

For each candidate node, set `metadata` according to where the evidence lives:

- Intent source only (no code yet, e.g. a fresh PRD): set `metadata.sourceReferences = [intent ref]` plus `metadata.implementationMissing = true`. Status stays `draft`.
- Code source only (running code with no spec): set `metadata.sourceReferences = [code ref]` plus `metadata.intentMissing = true`. Status `draft`.
- Both sources agree: set `metadata.sourceReferences = [intent ref, code ref]`. Status `draft` (only the human can promote to `completed` on apply).
- Both sources disagree: distinguish identity-level disagreement from field-level drift (see below).

Every node you emit MUST have `metadata` set. A node with `metadata.sourceReferences: []` AND no `implementationMissing` AND no `intentMissing` will be rejected by the server validator.

When a node has multiple sources to cite (intent plus one or more code files, or several layers of code), order them by representativeness: see `proposal-format.md` § Picking sourceReferences.

#### Identity-Level Disagreement: ClarifyTicket

You can't tell whether two sources are describing the *same* concept (alias or distinct? two unrelated `Order` definitions in different PRDs?). Don't pick. Emit a ClarifyTicket per Step 5 and stop.

#### Field-Level Drift: DriftIssue Attached to the Node

The sources agree on *what* this is, but disagree on *specifics*: a limit, a state set, a parameter list, a sequence of steps. Don't drop into a ClarifyTicket. Emit the node anyway and attach one structured `DriftIssue` per dimension to its `metadata.driftIssues[]`. Set `status: 'unclear'` instead of `draft` when at least one DriftIssue is `severity: 'error'`. Read `drift-detection.md` for the dimension checklist, description pattern, severity rules, and the JSON shape.

This split is load-bearing: ClarifyTickets are "the human must decide what this is", DriftIssues are "the human can see two sources disagree and act on the proposal review pane". Conflating them buries field-level drift in ticket prose where the validator can't gate Apply.

### Step 4: Submit the Proposal

Submit the Proposal via the `braid-core` proposal-create capability:

- `operations`: the GraphOperation array you derived in Step 2.
- `generatedBy`: `"ddd:extract"`.
- `rationale`: one paragraph stating what was extracted, from which sources, and why this scope split.

Outcomes: 201 means move on. 400 (`code: BRAID-VAL`) means fix the cited `issues[]` and resubmit, max 3 rounds; after that list remaining issues and stop. 409 (id collision) means mint a fresh id. 5xx means bail and report. `warning` issues don't block apply; mention them in `rationale` if intentional.

### Step 5: Submit ClarifyTicket (Low-Confidence Candidates)

Use the `braid-core` clarify-create capability with the question text and the candidate list. Each candidate must carry its own `proposedOperations`; the human's pick determines which ops run on Apply.

Before writing the `question` and each `candidate.description`, re-read `<cwd>/.claude/skills/ontology-ddd/concept.md` § ClarifyTickets: Reviewer Pool and Vocabulary. The reviewer pool for DDD workspaces is the cross-functional team (PM, RD, QA, designer); the ticket fields must read in their ubiquitous language, not in graph topology or code identifiers. Lower graph terms, exact node ids, and the engineering reasoning into the ticket's `context` field instead, which has no audience constraint.

## Output

stdout summary at the end:

```
Produced N proposals + M clarify tickets:
  - p-2026-05-12-abc (scope: ctx.checkout, 12 ops)
  - p-2026-05-12-def (scope: ctx.billing, 8 ops)
  - ct-2026-05-12-xyz (question: cancelOrder vs revokeOrder)
```

## Completion Checklist

- [ ] Ontology fetched from `braid-core` before any operation was drafted; every `node.type` / `edge.type` matches an id in the response.
- [ ] Wiring rules in `ontology-ddd/concept.md` followed (parent edges, no Context Mapping auto-emit, policy has both edges, `dependsOn` is aggregate-to-aggregate).
- [ ] Every node has `metadata.sourceReferences` and / or an `implementationMissing` / `intentMissing` flag.
- [ ] Field-level disagreement between sources surfaces as a `DriftIssue` on the node (see `drift-detection.md`), not a ClarifyTicket.
- [ ] Each proposal was submitted via `braid-core` proposal-create and the final response was 201 (not 4xx).
- [ ] No `removeNode` of a node still referenced elsewhere; deprecate instead.
- [ ] Each ClarifyTicket candidate carries `proposedOperations`.
- [ ] Final stdout lists outcomes (or, if proposal-create kept returning 400 after 3 rounds, lists the remaining issues).

## Companion Docs

Companion docs sit at `<cwd>/.claude/skills/shared/` (core) and `<cwd>/.claude/skills/ontology-ddd/` (this plugin), where `<cwd>` is the value captured in Initialization step 2.

| File | When to read | Why |
|---|---|---|
| `.claude/skills/ontology-ddd/concept.md` | **Before Step 2 and any time you author a node / edge** | The DDD vocabulary, wiring rules, policy pattern, Context Mapping rules, ID prefix conventions, and per-type description aspects. The contract for everything Step 2 does. |
| `.claude/skills/shared/proposal-format.md` | Before Step 4 | `GraphOperation` discriminated union, `DriftIssue` shape, status semantics, sizing. |
| `.claude/skills/shared/clarify-format.md` | Before Step 5 | `ClarifyTicket` request body and candidate shape. |
| `.claude/skills/shared/content-conventions.md` | Whenever writing a `name`, `description`, `rationale`, or `question` | Plain-text rule, length caps, structural conventions for every user-facing string field. |
| `.claude/skills/shared/validators.md` | Before Step 4 | The four server-side validators; self-check ops here so they don't hit a 400 unnecessarily. |
| `.claude/skills/shared/drift-detection.md` | Step 3, when two sources disagree on a field | Dimension checklist + description pattern for `DriftIssue` entries; severity rules. |

## Notes

- Found a pre-existing bad node (wrong type, missing description) that no source mentions? Produce a ClarifyTicket asking what to do. Do not silently fix.
- If `$BRAID_WORKSPACE/skill-extensions/ddd-extract/EXTEND.md` exists, follow its rules after the steps above. Workspace-specific ID conventions / status enums / source patterns go there.
