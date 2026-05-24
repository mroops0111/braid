# Artifact JSON formats

Skills create artifacts via the server API (`POST /workspaces/:ws/proposals` and `POST /workspaces/:ws/clarify`). The server validates the body, mints `id` / `generatedAt`, sets `status: "pending"`, and persists to disk. The shapes below describe the **request body** the skill sends and the **full record** the API returns.

## Proposal

Server response (and on-disk shape):

```json
{
  "id": "p-2026-05-12-abc123",
  "workspaceId": "${BRAID_WORKSPACE_ID}",
  "status": "pending",
  "operations": [ /* GraphOperation[] */ ],
  "generatedBy": "extract",
  "generatedAt": "2026-05-12T14:23:00+08:00",
  "rationale": "One paragraph: why these ops, what triggered the proposal."
}
```

Request body for `POST /workspaces/:ws/proposals` is the same minus the server-controlled fields (`id`, `status`, `generatedAt`):

```json
{
  "operations": [ /* GraphOperation[] */ ],
  "generatedBy": "extract",
  "rationale": "One paragraph: why these ops, what triggered the proposal.",
  "externalReferences": [{ "kind": "redmine", "url": "...", "label": "..." }]
}
```

Required: `id`, `workspaceId`, `status` (always `"pending"` for a new
proposal), `operations`, `generatedBy` (the skill id), `generatedAt`
(ISO 8601 with offset), `rationale`.

Optional: `externalReferences` (`[{kind, url, label?}]`) for linking
back to Redmine / Jira / XWiki source tickets.

## GraphOperation (discriminated union on `operation`)

```json
{ "operation": "addNode", "payload": { "type": "command", "name": "voidTask", "id": "cmd.voidTask" } }
{ "operation": "addNodes", "payloads": [ ...NewGraphNode ] }
{ "operation": "removeNode", "nodeId": "..." }
{ "operation": "removeNodes", "nodeIds": [ "...", "..." ] }
{ "operation": "updateNode", "nodeId": "...", "patch": { "status": "completed" } }
{ "operation": "updateNodes", "updates": [{ "nodeId": "...", "patch": {...} }] }
{ "operation": "addEdge", "payload": { "type": "CONTAINS", "fromNodeId": "ctx.x", "toNodeId": "agg.y" } }
{ "operation": "addEdges", "payloads": [ ...NewGraphEdge ] }
{ "operation": "removeEdge", "edgeId": "..." }
{ "operation": "removeEdges", "edgeIds": [ "...", "..." ] }
{ "operation": "updateEdge", "edgeId": "...", "patch": { "type": "..." } }
{ "operation": "updateEdges", "updates": [{ "edgeId": "...", "patch": {...} }] }
```

`type` and `status` valid values are defined by the active **Ontology** plugin (default `ontology-ddd`). Pull the current ontology types from `GET /workspaces/:ws/ontology`. The server validator rejects any type not in that list.

## DriftIssue (attached to a node's metadata)

When two sources for the same node disagree on a specific field
(intent vs code, code vs code, intent vs intent), attach a `DriftIssue`
to the node's `metadata.driftIssues[]` rather than dropping the work
into a ClarifyTicket. See `drift-detection.md` for when to use this vs
ClarifyTicket and how to write the description.

```json
{
  "id": "drift-{shortRandom}",
  "description": "Intent (intent/task.md §Quota) caps signers at 50; code at apps/api/task/validator.ts:14 allows up to 99. Extra signers fail a downstream DB unique check silently.",
  "severity": "error",
  "sourceReferences": [
    { "sourceId": "src-intent", "location": { "uri": "intent/task.md", "anchor": "Quota" } },
    { "sourceId": "src-code",   "location": { "uri": "apps/api/task/validator.ts", "startLine": 14 } }
  ],
  "raisedAt": "2026-05-24T10:15:00+08:00"
}
```

Required: `id`, `description` (non-empty), `severity`
(`error` / `warning` / `info`), `sourceReferences` (**≥ 2** entries),
`raisedAt` (ISO 8601 with offset). `EvidenceValidator` surfaces each
entry as a `ValidationIssue` with `code: "evidence.drift"`. Errors
block proposal apply.

`metadata.acknowledgedDrifts: string[]` is a sibling field that
suppresses any DriftIssue whose `description` matches exactly. It's
a **human acknowledgement** field; skills do not write it.

## ClarifyTicket (when extract / model finds ambiguity)

```json
{
  "id": "ct-2026-05-12-xyz",
  "workspaceId": "${BRAID_WORKSPACE_ID}",
  "question": "voidTask and cancelTask: same command or distinct?",
  "candidates": [
    {
      "id": "cc-1",
      "description": "Merge: they are aliases",
      "sourceReferences": [{ "sourceId": "src-api", "location": { "uri": "...", "startLine": 12 } }],
      "proposedOperations": [{ "operation": "removeNode", "nodeId": "cmd.cancelTask" }]
    },
    {
      "id": "cc-2",
      "description": "Distinct: they fire different events",
      "sourceReferences": [],
      "proposedOperations": []
    }
  ],
  "status": "pending"
}
```

Submit via `POST /workspaces/:ws/clarify` when the skill cannot decide. Don't guess. Produce a clarify ticket and let a human resolve it via the Studio UI.

## ID generation

Node and edge IDs are minted by the skill (ontology-style: `cmd.voidTask`, `ctx.signup`, `evt.OrderPlaced`, …). Proposal and clarify ticket IDs are minted by the server when you POST; **do not pre-mint them in the skill**.

## Atomic writes

You don't need them. The server handles atomic persistence (`mv tmp final` inside `FsProposalRepository`). Skills just POST.

(Legacy bash example, kept for historical reference; do not use in new skills:)

```bash
cat > "$tmp" <<EOF
{...}
EOF
mv "$tmp" "$final"
```

## Scratch files

If you need a local file to draft a JSON body before POSTing (for
validation, multi-step composition, or because a tool requires reading a
file), write to `$BRAID_SESSION_DIR` (the per-run session directory the
skill runner sets as your working directory and exports as an env var).
**Do not** write scratch JSON to `/tmp`:

- `$BRAID_SESSION_DIR` is sandboxed per run, lives under
  `<workspace>/artifacts/sessions/<runId>/`, and is preserved alongside
  the run record. Reviewers can inspect drafts after the fact.
- `/tmp` is a global, multi-user scratch space that the OS wipes
  unpredictably and is visible to other processes on the same machine.

Example:

```bash
draft="$BRAID_SESSION_DIR/proposal.draft.json"
jq -n '{ operations: [...], rationale: "...", generatedBy: "braid-extract" }' > "$draft"
# inspect / validate the draft, then:
curl -sS -X POST "$BRAID_API_URL/workspaces/$BRAID_WORKSPACE_ID/proposals" \
  -H 'Content-Type: application/json' \
  --data @"$draft"
```
