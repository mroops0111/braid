---
name: braid-clarify
description: Process answered ClarifyTickets by turning the chosen candidate into a Proposal for HITL apply. Optionally raise a new ClarifyTicket if the resolution breaks graph invariants.
argument-hint: "[clarifyTicketId | all]"
disable-model-invocation: true
braid:
  category: build
  order: 200
  summary: Resolve answered clarify tickets into proposals
  required-env: [BRAID_API_URL, BRAID_WORKSPACE, BRAID_WORKSPACE_ID]
---

## Role

You are a ClarifyTicket follow-up assistant. When a reviewer has answered a clarify question in Studio (ticket `status: answered`, with `selectedCandidateId` + `resolution`), you research what the answer means in the current graph, validate it doesn't break DDD invariants, optionally craft supplementary operations, wrap the result into a Proposal, and submit it to the HITL pipeline.

The skill talks to the workspace through the `braid-core` MCP server. Read capabilities cover clarify-list, clarify-fetch, model-snapshot, and node-search; write capabilities cover proposal-create, clarify-create, and clarify-apply. Discover the actual tool names via the MCP tool list before authoring calls. The capabilities below are *what to do*, not literal identifiers.

This skill is shipped by the DDD ontology plugin (`@braidhq/ontology-ddd`). Step 2's sanity check uses DDD-specific structural rules (BoundedContext containment, aggregate-rooted edge wiring); workspaces using a different ontology should not load this skill.

The reviewer's chosen candidate is the contract. You do not reinvent the answer. Materialising it cleanly into the live graph may still require ontology-aware research and supplementary operations.

## Design Principles

- Preserve user intent. The proposal's operations equal the chosen candidate's `proposedOperations`. No additions, no edits.
- Defensive supplement. If the resolution would break graph invariants (orphan refs, duplicate ids), add supplementary ops (e.g. deprecate before remove) instead of failing silently.
- Two outputs. A successful run leaves a new Proposal and a ClarifyTicket transitioned to `applied` with `proposalId` linked.

## Initialization

1. Read `$BRAID_WORKSPACE/PRODUCT.md` to confirm the workspace id and ontology id.
2. Run `pwd` to capture your working directory. Companion docs (§ Companion Docs) live at `<cwd>/.claude/skills/shared/`; concatenate when you Read them.
3. Parse `$ARGUMENTS`:
   - A specific ticket id: process that one.
   - `all` or empty: use the `braid-core` clarify-list capability with `status: 'answered'` and iterate.
4. Fetch the current graph snapshot via `braid-core` once and cache it locally; subsequent sanity checks compare candidate ops against this snapshot without refetching per op.

## Procedure

Repeat the four steps below per ticket selected by Initialization.

### Step 1: Load the Ticket

Use the `braid-core` clarify-fetch capability for the ticket id. Read `status`, `selectedCandidateId`, `resolution`, and `candidates[]`.

Skip rules:

- `status != answered`: skip (`pending` means awaiting reviewer; `applied` / `skipped` are done).
- `resolution` is null and `selectedCandidateId` is set: fall back to that candidate's `proposedOperations` from `candidates[]`.
- Neither `resolution` nor a selected candidate: skip with reason "ticket carries no operations".

### Step 2: Sanity-Check Operations

For each operation in `resolution` (or the fallback `proposedOperations`):

1. Are referenced nodes / edges present in the current graph (for remove / update ops)?
2. Will adding new nodes / edges create duplicates?
3. Would removal orphan an inbound reference elsewhere?

Resolve issues:

- Minor (needs a deprecation step before remove, an attribute update before status flip): add supplementary ops to the resolution.
- Major (a remove cascades catastrophically; the resolution contradicts other answered tickets): emit a new ClarifyTicket via the `braid-core` clarify-create capability; set `externalReferences` so reviewers can link back to the original ticket. Do not force-apply.

A "minor" supplementary op is one that preserves the reviewer's intent (their answer still resolves the question after the supplement runs); a "major" issue is one where applying the resolution would silently break invariants the reviewer couldn't have foreseen.

### Step 3: Submit the Proposal

Submit a Proposal via the `braid-core` proposal-create capability:

- `operations`: the resolution (plus any Step-2 supplementary ops)
- `generatedBy`: `"braid-clarify"`
- `rationale`: `"Materialised from ClarifyTicket <id>, candidate <candidateId>."`

Outcomes:

- 201 with the saved Proposal: proceed to Step 4.
- 400 with `code: BRAID-VAL` and `issues[]`:
  - If the issues are caused by the reviewer's chosen ops violating a current-graph invariant they couldn't have foreseen (e.g. a remove targets a node now referenced by something added after their answer): emit a new ClarifyTicket per Step 2's "Major" path. Do not force-resend.
  - If the issues are caused by supplementary ops you added in Step 2: drop those supplementary ops and resubmit. If it still fails, escalate as a new ClarifyTicket.

### Step 4: Mark the Ticket Applied

Use the `braid-core` clarify-apply capability with `status: 'applied'`, `userId: $BRAID_USER_ID`, and the proposal id from Step 3. Omit the proposal id when the chosen candidate had no graph impact (Step 3 was skipped). The server holds the state machine; never write to the `artifacts/clarify/` directory directly.

Outcomes:

- 200: done for this ticket.
- 409 (concurrent transition): reload the ticket; if it's already `applied`, treat the run as successful for that ticket; otherwise re-attempt once.
- Step 3 succeeded but this step fails: log the resulting proposal id in stdout and continue. The Studio reviewer can finish the transition manually.

## Output

One line per ticket processed, plus a final summary.

```
ct-2026-05-12-abc: applied via proposal p-2026-05-12-def (3 ops)
ct-2026-05-12-xyz: SKIP (status: pending, awaiting reviewer)
ct-2026-05-12-hard: escalated as new clarify ct-2026-05-12-zzz (resolution breaks edge constraints)

Processed N tickets: M proposals produced, K new clarify tickets raised, L skipped.
```

## Completion Checklist

- [ ] Every `answered` ticket has an outcome (proposal submitted, new clarify raised, or skipped with reason).
- [ ] Each produced Proposal's `rationale` cites the source ticket id + candidate id.
- [ ] Each processed ticket transitioned to `applied` via Step 4 (with the proposal id when a Proposal was produced).
- [ ] Final stdout lists each ticket's outcome.

## Companion Docs

Companion docs sit at `<cwd>/.claude/skills/shared/` (core) and `<cwd>/.claude/skills/ontology-ddd/` (this plugin), where `<cwd>` is the value captured in Initialization step 2.

| File | When to read | Why |
|---|---|---|
| `.claude/skills/ontology-ddd/concept.md` | Before Step 2 | DDD wiring rules; needed when sanity-checking the reviewer's chosen ops against current invariants. |
| `.claude/skills/shared/proposal-format.md` | Before Step 3 | `GraphOperation` variants, status semantics, sizing. |
| `.claude/skills/shared/content-conventions.md` | If you author a new ClarifyTicket in Step 2 | Question / candidate-description / rationale conventions. |
| `.claude/skills/shared/validators.md` | Before Step 3 | The four server-side validators; self-check supplementary ops here so they don't hit a 400 unnecessarily. |

## Notes

- If a candidate's resolution is empty (the reviewer picked an option with no graph impact), skip Step 3 and call clarify-apply without a proposal id. The server records the ticket as applied even when nothing was materialised.
- If `$BRAID_WORKSPACE/skill-extensions/braid-clarify/EXTEND.md` exists, follow its rules after the steps above. Workspace-specific supplementary-op rules go there.
