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
| `.claude/skills/shared/api-routes.md` | initialisation. REST endpoint reference |
| `.claude/skills/shared/artifact-formats.md` | before writing. Exact Proposal JSON shape |

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

## Step 3: build & write the Proposal

```bash
PROPOSAL_ID="p-$(date -u +%Y-%m-%d)-$(uuidgen | cut -c1-8)"
TMP=$(mktemp)
cat > "$TMP" <<EOF
{
  "id": "$PROPOSAL_ID",
  "workspaceId": "$TELOS_WORKSPACE_ID",
  "status": "pending",
  "operations": $RESOLUTION,
  "generatedBy": "telos-clarify",
  "generatedAt": "$(date -u -Iseconds)",
  "rationale": "Materialised from ClarifyTicket $TICKET_ID, candidate $SELECTED."
}
EOF
mv "$TMP" "$TELOS_WORKSPACE/artifacts/proposals/pending/$PROPOSAL_ID.json"
```

## Step 4: mark the ticket applied

Move the ticket file from `answered/` to `applied/` and stamp the `proposalId`:

```bash
TICKET_PATH="$TELOS_WORKSPACE/artifacts/clarify/answered/$TICKET_ID.json"
UPDATED=$(jq --arg pid "$PROPOSAL_ID" '.status = "applied" | .proposalId = $pid' "$TICKET_PATH")
TMP=$(mktemp)
echo "$UPDATED" > "$TMP"
mv "$TMP" "$TELOS_WORKSPACE/artifacts/clarify/applied/$TICKET_ID.json"
rm -f "$TICKET_PATH"
```

# Output

One line per ticket processed, plus a final summary:

```
ct-2026-05-12-abc → proposal p-2026-05-12-def (3 ops)
ct-2026-05-12-xyz → SKIP (status: pending, awaiting user)
ct-2026-05-12-hard → new clarify ct-2026-05-12-zzz (resolution breaks edge constraints)

Processed N tickets: M proposals produced, K new clarify tickets raised, L skipped.
```

# Completion Checklist

- [ ] Every `answered` ticket has an outcome (proposal written, new clarify raised, or skipped with reason)
- [ ] Each produced Proposal's `rationale` cites the source ticket id + candidate id
- [ ] Each processed ticket moved from `answered/` to `applied/` with `proposalId` stamped
- [ ] All file writes use `mv tmp final` atomic pattern
- [ ] Final stdout lists each ticket's outcome

# Notes

- **Do not modify** `operations` except to preserve invariants (don't change user intent)
- If a candidate's `resolution` is an empty array (user picked an option that has no graph impact) → do **not** produce a Proposal; move ticket to `applied/` as a record only
- Don't reprocess already-applied tickets: check `clarify/applied/` and `clarify/skipped/` first
- If `$TELOS_WORKSPACE/skill-extensions/telos-clarify/EXTEND.md` exists,
  follow its rules **after** the steps above. Workspace-specific
  supplementary-op rules go there
