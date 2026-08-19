---
name: clarify
description: Process answered Clarifications by turning the chosen candidate into a Proposal for HITL apply. Optionally raise a new Clarification if the resolution breaks graph invariants.
argument-hint: "[clarificationId | all]"
disable-model-invocation: true
braid:
  category: build
  order: 200
  summary: Resolve answered clarifications into proposals
  required-env: [BRAID_API_URL, BRAID_WORKSPACE, BRAID_WORKSPACE_ID, BRAID_SHARED_REFERENCE, BRAID_ONTOLOGY_REFERENCE]
  inputs:
    - name: clarification
      label: Clarification
      description: An answered clarification to materialise. Leave empty to process every answered clarification in the workspace.
      kind: pick
      optional: true
      provider:
        kind: clarify
        filter: { status: answered }
      fallback: disabled
---

## Role

You are a Clarification follow-up assistant. When a reviewer has answered a clarify question in Studio (clarification `status: answered`, with `selectedCandidateId` + `resolution`), you research what the answer means in the current graph, validate it doesn't break DDD invariants, optionally craft supplementary operations, wrap the result into a Proposal, and submit it to the HITL pipeline.

The skill talks to the workspace through the `braid-core` MCP server. Read capabilities cover clarification-list, clarification-fetch, model-snapshot, and node-search; write capabilities cover proposal-create, clarification-create, and clarification-apply. Discover the actual tool names via the MCP tool list before authoring calls. The capabilities below are *what to do*, not literal identifiers.

This skill is shipped by the DDD ontology plugin (`@braidhq/ontology-ddd`). Step 2's sanity check uses DDD-specific structural rules (BoundedContext containment, aggregate-rooted edge wiring); workspaces using a different ontology should not load this skill.

The reviewer's chosen candidate is the contract. You do not reinvent the answer. Materialising it cleanly into the live graph may still require ontology-aware research and supplementary operations.

## Design Principles

- Preserve user intent. The proposal's operations equal the chosen candidate's `proposedOperations`. No additions, no edits.
- Defensive supplement. If the resolution would break graph invariants (orphan refs, duplicate ids), add supplementary ops (e.g. deprecate before remove) instead of failing silently.
- Two outputs. A successful run leaves a new Proposal that links back to the Clarification, and the Clarification stays `answered`. Applying the Proposal in Studio transitions the Clarification to `applied`.

## Initialization

1. Read `$BRAID_WORKSPACE/PRODUCT.md` to confirm the workspace id and ontology id.
2. Note `$BRAID_SHARED_REFERENCE` (framework contracts) and `$BRAID_ONTOLOGY_REFERENCE` (the active ontology). Companion docs (§ Companion Docs) live under those paths; concatenate when you Read them.
3. Parse `$ARGUMENTS`:
   - A specific clarification id: process that one.
   - `all` or empty: use the `braid-core` clarification-list capability with `status: 'answered'` and iterate.
4. Fetch the current graph snapshot via `braid-core` once and cache it locally; subsequent sanity checks compare candidate ops against this snapshot without refetching per op.

## Procedure

Repeat the four steps below per clarification selected by Initialization.

### Step 1: Load the Clarification

Use the `braid-core` clarification-fetch capability for the clarification id. Read `status`, `selectedCandidateId`, `resolution`, and `candidates[]`.

Skip rules:

- `status != answered`: skip (`pending` means awaiting reviewer; `applied` / `skipped` are done).
- `resolution` is null and `selectedCandidateId` is set: fall back to that candidate's `proposedOperations` from `candidates[]`.
- Neither `resolution` nor a selected candidate: skip with reason "clarification carries no operations".

### Step 2: Sanity-Check Operations

For each operation in `resolution` (or the fallback `proposedOperations`):

1. Are referenced nodes / edges present in the current graph (for remove / update ops)?
2. Will adding new nodes / edges create duplicates?
3. Would removal orphan an inbound reference elsewhere?

Resolve issues:

- Minor (needs a deprecation step before remove, an attribute update before status flip): add supplementary ops to the resolution.
- Major (a remove cascades catastrophically; the resolution contradicts other answered clarifications): emit a new Clarification via the `braid-core` clarification-create capability; set `externalReferences` so reviewers can link back to the original clarification. Do not force-apply.

A "minor" supplementary op is one that preserves the reviewer's intent (their answer still resolves the question after the supplement runs); a "major" issue is one where applying the resolution would silently break invariants the reviewer couldn't have foreseen.

### Step 3: Submit the Proposal

Submit a Proposal via the `braid-core` proposal-create capability:

- `operations`: the resolution (plus any Step-2 supplementary ops)
- `generatedBy`: `"ddd:clarify"`
- `clarificationId`: the id of the Clarification being resolved, so applying the Proposal later closes it.
- `rationale`: `"Materialised from Clarification <id>, candidate <candidateId>."`

Outcomes:

- 201 with the saved Proposal: proceed to Step 4.
- 400 with `code: BRAID-VAL` and `issues[]`:
  - If the issues are caused by the reviewer's chosen ops violating a current-graph invariant they couldn't have foreseen (e.g. a remove targets a node now referenced by something added after their answer): emit a new Clarification per Step 2's "Major" path. Do not force-resend.
  - If the issues are caused by supplementary ops you added in Step 2: drop those supplementary ops and resubmit. If it still fails, escalate as a new Clarification.

### Step 4: Close a No-Impact Clarification

A Clarification that produced a Proposal stays `answered`. Applying that Proposal in Studio is what transitions the Clarification to `applied`, so do not close it here.

Only when the chosen candidate had no graph impact (Step 3 was skipped, so no Proposal exists) do you close the Clarification directly. Use the `braid-core` clarification-apply capability with `status: 'applied'` and `userId: $BRAID_USER_ID`, and omit the proposal id. The server holds the state machine, never write to the `artifacts/clarifications/` directory directly.

Outcomes:

- 200: done for this Clarification.
- 409 (concurrent transition): reload the Clarification. If it is already `applied`, treat the run as successful. Otherwise re-attempt once.

## Output

One line per clarification processed, plus a final summary.

```
ct-2026-05-12-abc: proposal p-2026-05-12-def created (3 ops), awaiting reviewer apply
ct-2026-05-12-xyz: SKIP (status: pending, awaiting reviewer)
ct-2026-05-12-hard: escalated as new clarification ct-2026-05-12-zzz (resolution breaks edge constraints)

Processed N clarifications: M proposals produced, K new clarifications raised, L skipped.
```

## Completion Checklist

- [ ] Every `answered` Clarification has an outcome (Proposal submitted, new Clarification raised, or skipped with reason).
- [ ] Each produced Proposal's `rationale` cites the source Clarification id + candidate id.
- [ ] Each no-impact Clarification was closed to `applied` in Step 4. Each Clarification with a Proposal was left `answered` for the reviewer to apply.
- [ ] Final stdout lists each clarification's outcome.

## Referencing Nodes

When any prose you write names a graph node, write it as the token `@node:<id>` instead of a bare id. Studio renders the token as a live tag carrying the node's name and description. This applies to your narration, to `clarification.context`, to `proposal.rationale`, and to `node.description`. It does not apply to `clarify.question` or `candidate.description`, whose audience rule is unchanged. Full grammar in `$BRAID_SHARED_REFERENCE/reference-syntax.md`.

## Companion Docs

Companion docs live under `$BRAID_SHARED_REFERENCE/` and `$BRAID_ONTOLOGY_REFERENCE/`.

| File | When to Read | Why |
|---|---|---|
| `$BRAID_ONTOLOGY_REFERENCE/concept.md` | Before Step 2 | DDD wiring rules; needed when sanity-checking the reviewer's chosen ops against current invariants. |
| `$BRAID_SHARED_REFERENCE/proposal-format.md` | Before Step 3 | `GraphOperation` variants, status semantics, sizing. |
| `$BRAID_SHARED_REFERENCE/content-conventions.md` | If you author a new Clarification in Step 2 | Question / candidate-description / rationale conventions. |
| `$BRAID_SHARED_REFERENCE/validators.md` | Before Step 3 | The four server-side validators; self-check supplementary ops here so they don't hit a 400 unnecessarily. |
| `$BRAID_SHARED_REFERENCE/reference-syntax.md` | Whenever prose names a node | Token grammar for node references, and which fields accept them. |

## Notes

- If a candidate's resolution is empty (the reviewer picked an option with no graph impact), skip Step 3 and call clarification-apply without a proposal id. The server records the clarification as applied even when nothing was materialised.
- If `$BRAID_WORKSPACE/skill-extensions/ddd-clarify/EXTEND.md` exists, follow its rules after the steps above. Workspace-specific supplementary-op rules go there.
