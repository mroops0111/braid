# ClarifyTicket Format

What a skill puts on the wire for the `braid-core` clarify-create capability that the MCP tool schema can't describe on its own. The envelope shape (`question`, `candidates`, `externalReferences`) is in the MCP tool's `inputSchema` and not repeated here. What this doc covers:

- Candidate shape (the gateway flattens `proposedOperations[]` to `dict[str, Any]` in MCP).
- Status transitions and which one a skill is allowed to drive.
- The "don't guess" principle that decides when to emit a ClarifyTicket vs a DriftIssue.

For `question` / `candidate.description` content rules (length, single-line, ending in `?`), see `content-conventions.md`. For per-field schema caps and validation, see the OpenAPI `inputSchema`. For the validator that checks the selected candidate's ops at answer-time, see `validators.md`.

## Candidate Shape

```jsonc
{
  "id": "cc-merge",                     // optional; server mints if absent
  "description": "Merge as aliases",    // single line, ≤ 200 chars (see content-conventions.md)
  "sourceReferences": [                  // optional; cite the evidence behind this reading
    { "sourceId": "...", "location": { "uri": "...", "anchor": "..." } }
  ],
  "proposedOperations": [               // the GraphOperations that run if the human picks this candidate
    { /* GraphOperation; see proposal-format.md */ }
  ]
}
```

The `proposedOperations` of a candidate are **not validated at create time**. They're only validated when a human selects the candidate via the reviewer's clarify-answer call (the validator gate runs there). So a skill can include exploratory candidates with risky ops; the human's selection is what gets committed.

## Status Transitions

- `pending`: created by a skill; waiting for human selection.
- `answered`: human picked a candidate via Studio; `selectedCandidateId` + `resolution` are set, but no Proposal has been materialised yet.
- `applied`: `braid-clarify` wrapped the resolution into a Proposal (or determined the chosen candidate has no graph impact) and called the `braid-core` clarify-apply capability.
- `skipped`: human dismissed the ticket via Studio.

Only `pending → answered → applied` and `pending → skipped` are legal. Skills do not write to the `artifacts/clarify/` tree directly; the server holds the state machine.

The `pending → answered` transition is human-driven (Studio UI). The `answered → applied` transition is what `braid-clarify` calls via the clarify-apply capability after materialising the resolution.

## Don't Guess

When the skill is unsure which of two readings the source intends, the right move is a ClarifyTicket, not a "least bad" Proposal. Reviewers can resolve a question; they can't easily undo a wrong commit.

The threshold for emitting one:

- **Identity question** (are these the same node? alias or distinct? which of multiple readings is right?) → ClarifyTicket.
- **Field-level disagreement on a shared identity** (sources agree what this node is, disagree on a limit / state / sequence) → `DriftIssue` on the node's metadata. See `drift-detection.md`.

Conflating these buries field drift in ticket prose where the validator can't gate Apply.
