# Clarification Format

When a skill raises a clarification, and what it may do with one afterwards. Every field of one, and what each is for, is in the MCP tool's `inputSchema`, so nothing about a field's shape or its allowed values is repeated here. What this doc covers:

- Which transition a skill is allowed to drive.
- The "don't guess" principle that decides when to emit a Clarification vs a DriftIssue.

For `question` / `candidate.description` content rules (length, single-line, ending in `?`), see `content-conventions.md`. For the validator that checks the selected candidate's ops at answer-time, see `validator-rules.md`.

## Status Transitions

Only the chains `pending` to `answered` to `applied`, and `pending` to `skipped`, are legal. Skills do not write to the `artifacts/clarifications/` tree directly; the server holds the state machine.

The `pending` to `answered` transition is human-driven (Studio UI). The `answered` to `applied` transition is what the clarify skill calls via the clarification-apply capability after materialising the resolution.

## Don't Guess

When the skill is unsure which of two readings the source intends, the right move is a Clarification, not a "least bad" Proposal. Reviewers can resolve a question; they can't easily undo a wrong commit.

The threshold for emitting one:

- **Identity question** (are these the same node? alias or distinct? which of multiple readings is right?): emit a Clarification.
- **Field-level disagreement on a shared identity** (sources agree what this node is, disagree on a limit / state / sequence): emit a `DriftIssue` on the node's metadata. See `drift-detection.md`.

Conflating these buries field drift in clarification prose where the validator can't gate Apply.

