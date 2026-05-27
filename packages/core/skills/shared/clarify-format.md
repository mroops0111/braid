# ClarifyTicket Format

The shape of the JSON a skill produces via the `createClarifyTicket`
MCP tool when it cannot pick between candidate interpretations.

## When to Emit

Emit a ClarifyTicket when the disagreement is about **identity** —
"are these even the same concept? should they merge or stay distinct?
which of these alternative readings is correct?". Field-level
disagreement on a shared concept goes into `DriftIssue` on the node's
metadata instead; see `drift-detection.md`.

The contract: every ClarifyTicket carries one or more `candidates`,
each with its own `proposedOperations`. The human picks one in
Studio; that selection is forwarded into a Proposal by the
`braid-clarify` skill.

## Request Body (Passed to `createClarifyTicket`)

```json
{
  "question": "cancelOrder and revokeOrder: same command or distinct?",
  "candidates": [
    {
      "id": "cc-1",                       // optional; server mints if absent
      "description": "Merge: they are aliases",
      "sourceReferences": [
        { "sourceId": "src-api", "location": { "uri": "apps/api/order/handlers.ts", "startLine": 12 } }
      ],
      "proposedOperations": [
        { "operation": "removeNode", "nodeId": "cmd.revokeOrder" }
      ]
    },
    {
      "id": "cc-2",
      "description": "Distinct: revokeOrder fires a different event chain",
      "sourceReferences": [
        { "sourceId": "src-intent", "location": { "uri": "intent/order-lifecycle.md", "anchor": "Cancellation" } }
      ],
      "proposedOperations": []  // human accepting this candidate keeps the graph as-is
    }
  ],
  "externalReferences": [{ "kind": "linear", "url": "...", "label": "..." }]
}
```

## Server Response (and On-Disk Shape)

```json
{
  "id": "ct-2026-05-12-xyz",
  "workspaceId": "<workspace id>",
  "question": "cancelOrder and revokeOrder: same command or distinct?",
  "candidates": [ ...same as request, but with server-minted candidate ids if you omitted them ],
  "status": "pending",
  "answeredBy": null,                // set when the human picks
  "selectedCandidateId": null,       // set when the human picks
  "resolution": null,                // set when the human picks; mirrors the selected candidate's proposedOperations
  "proposalId": null,                // set by braid-clarify after it materialises the answer
  "externalReferences": [ ... ]
}
```

## Candidate Shape

```jsonc
{
  "id": "cc-merge",                   // optional; server mints if absent
  "description": "Short, reviewer-facing.",
  "sourceReferences": [               // optional; cite the evidence behind this reading
    { "sourceId": "...", "location": { "uri": "...", "anchor": "..." } }
  ],
  "proposedOperations": [             // the GraphOperations that run if the human picks this candidate
    ...
  ]
}
```

The `proposedOperations` of a candidate are **not validated at create
time** — they're only validated when a human selects the candidate via
`answerClarifyTicket` (the validator gate runs there). So a skill can
include exploratory candidates with risky ops; the human's selection
is what gets committed.

## Status Transitions

- `pending`: created by a skill; waiting for human selection.
- `answered`: human picked a candidate via Studio; `selectedCandidateId` + `resolution` are set, but no Proposal has been materialised yet.
- `applied`: `braid-clarify` wrapped the resolution into a Proposal (or determined the chosen candidate has no graph impact) and called `markClarifyTicketApplied`.
- `skipped`: human dismissed the ticket via Studio.

Only `pending → answered → applied` and `pending → skipped` are legal.
Skills do not write to the `artifacts/clarify/` tree directly; the
server holds the state machine.

## Don't Guess

When the skill is unsure, the right move is a ClarifyTicket — not a
"least bad" Proposal. Reviewers can resolve a question, but they
can't easily undo a wrong commit.
