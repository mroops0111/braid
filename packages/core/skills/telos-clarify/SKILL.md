---
name: telos-clarify
description: Process answered ClarifyTickets by turning the chosen candidate into a Proposal for HITL apply. Optionally raise a new ClarifyTicket if the resolution breaks graph invariants.
argument-hint: "[clarifyTicketId | all]"
disable-model-invocation: true
telos:
  required-env: [TELOS_API_URL, TELOS_WORKSPACE, TELOS_WORKSPACE_ID]
---

# Role

You are a ClarifyTicket follow-up assistant. When a user has answered a
clarify question in Studio (ticket `status: answered`, with
`selectedCandidateId` + `resolution`), you read the resolution, wrap it
into a Proposal, and submit to the HITL pipeline.

You **do not** reinvent the answer: the user already chose. You only
materialise their choice into a reviewable Proposal.

# Design Principles

| Principle | Why |
|-----------|-----|
| Preserve user intent | The proposal's operations = the chosen candidate's `proposedOperations`. No additions, no edits |
| Defensive supplement | If the resolution would break graph invariants, add supplementary ops (e.g. deprecate first, then remove) |
| Two outputs | Side-effect = Proposal written + ClarifyTicket marked `applied` with `proposalId` linked |

# References

| File | When to read |
|------|--------------|
| `$TELOS_SESSION_DIR/.claude/skills/shared/api-routes.md` | initialisation. REST endpoint reference |
| `$TELOS_SESSION_DIR/.claude/skills/shared/artifact-formats.md` | before writing. Exact Proposal JSON shape |

# Initialization

1. Read `$TELOS_WORKSPACE/PRODUCT.md` for workspace context (mainly to know which workspace id to write under).
2. Parse argument:
   - Specific ticket id → process that one
   - `all` or empty → list all `status: answered` tickets, iterate
3. Fetch ticket list when applicable:
   ```bash
   curl -sf "$TELOS_API_URL/workspaces/$TELOS_WORKSPACE_ID/clarify?status=answered" \
     | jq -r '.items[].id'
   ```

# Procedure (per ticket)

## Step 1: load the ticket

```bash
TICKET=$(curl -sf "$TELOS_API_URL/workspaces/$TELOS_WORKSPACE_ID/clarify/$TICKET_ID")
STATUS=$(echo "$TICKET" | jq -r '.status')
SELECTED=$(echo "$TICKET" | jq -r '.selectedCandidateId')
RESOLUTION=$(echo "$TICKET" | jq -c '.resolution // empty')
```

Skip rules:
- `status != answered` → skip (pending = awaiting user; applied / skipped = done)
- `resolution` is null → fall back to the selected candidate's `proposedOperations` from `.candidates[]`

## Step 2: sanity-check operations

For each operation in `RESOLUTION`:

1. Are referenced nodes / edges present in the current graph (for remove / update ops)?
2. Will adding new nodes / edges create duplicates?
3. Would removal orphan an inbound reference elsewhere?

Resolve issues:
- Minor (need a deprecation step before remove) → add supplementary ops to the resolution
- Major (a remove cascades catastrophically) → write a **new** ClarifyTicket with `relatedTicket: $TICKET_ID` and ask the user. **Do not** force-apply.

## Step 3: submit the Proposal via POST

The server validates the ops, mints the id, and persists. Do not write the
JSON file yourself.

```bash
BODY=$(jq -n \
  --argjson ops "$RESOLUTION" \
  --arg rat "Materialised from ClarifyTicket $TICKET_ID, candidate $SELECTED." \
  '{ operations: $ops, generatedBy: "telos-clarify", rationale: $rat }')

RESPONSE=$(curl -sS -X POST "$TELOS_API_URL/workspaces/$TELOS_WORKSPACE_ID/proposals" \
  -H 'Content-Type: application/json' \
  -d "$BODY" \
  -w '\n__HTTP_STATUS__:%{http_code}')
STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__:[0-9]*' | cut -d: -f2)
BODY_JSON=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__:[0-9]*//')
PROPOSAL_ID=$(echo "$BODY_JSON" | jq -r '.id')
```

If `STATUS=400` with `code: "TELOS-VAL"`, look at `BODY_JSON.issues` and decide:

- The candidate's ops violate an invariant the user couldn't have foreseen
  (e.g. removes a node still referenced) → write a **new** ClarifyTicket
  asking how to proceed; **do not** force-resend.
- The candidate's ops are valid but a sibling op also in `$RESOLUTION` is
  bad → only happens if you injected supplementary ops in Step 2; revisit.

## Step 4: link the ticket to the proposal

```bash
curl -sf -X PATCH \
  "$TELOS_API_URL/workspaces/$TELOS_WORKSPACE_ID/clarify/$TICKET_ID" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg pid "$PROPOSAL_ID" --arg uid "${TELOS_USER_ID:-telos-clarify}" \
        '{ proposalId: $pid, userId: $uid }')"
```

This transitions the ticket `answered → applied` and stamps `proposalId`
so the UI can navigate from a ticket back to its Proposal. The server
holds the state machine; never write to `artifacts/clarify/` directly.

# Output

One line per ticket processed, plus a final summary:

```
ct-2026-05-12-abc → proposal p-2026-05-12-def (3 ops)
ct-2026-05-12-xyz → SKIP (status: pending, awaiting user)
ct-2026-05-12-hard → new clarify ct-2026-05-12-zzz (resolution breaks edge constraints)

Processed N tickets: M proposals produced, K new clarify tickets raised, L skipped.
```

# Completion Checklist

- [ ] Every `answered` ticket has an outcome (proposal submitted, new clarify raised, or skipped with reason)
- [ ] Each produced Proposal's `rationale` cites the source ticket id + candidate id
- [ ] Each processed ticket moved from `answered/` to `applied/` with `proposalId` stamped (Step 4)
- [ ] Final stdout lists each ticket's outcome

# Notes

- Proposals are created via `POST /proposals` (server mints id + validates). **Do not** write proposal JSON directly to disk.
- **Do not modify** `operations` except to preserve invariants (don't change user intent)
- **Never use em-dashes (`—`) or en-dashes (`–`) in output text** (proposal rationale, new clarify candidate descriptions, etc.). Use periods, colons, commas, or parentheses instead
- If a candidate's `resolution` is an empty array (user picked an option that has no graph impact) → do **not** produce a Proposal; move ticket to `applied/` as a record only
- Don't reprocess already-applied tickets: check `clarify/applied/` and `clarify/skipped/` first
- If `$TELOS_WORKSPACE/skill-extensions/telos-clarify/EXTEND.md` exists,
  follow its rules **after** the steps above. Workspace-specific
  supplementary-op rules go there
