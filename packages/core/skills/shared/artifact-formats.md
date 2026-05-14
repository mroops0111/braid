# Artifact JSON formats

Skills create artifacts via the server API (`POST /workspaces/:ws/proposals` and `POST /workspaces/:ws/clarify`). The server validates the body, mints `id` / `generatedAt`, sets `status: "pending"`, and persists to disk. The shapes below describe the **request body** the skill sends and the **full record** the API returns.

## Proposal

Server response (and on-disk shape):

```json
{
  "id": "p-2026-05-12-abc123",
  "workspaceId": "${TELOS_WORKSPACE_ID}",
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

## ClarifyTicket (when extract / model finds ambiguity)

```json
{
  "id": "ct-2026-05-12-xyz",
  "workspaceId": "${TELOS_WORKSPACE_ID}",
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
