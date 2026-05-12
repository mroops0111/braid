# Artifact JSON formats

All skills that produce graph mutations write **Proposal JSON** to
`$TELOS_WORKSPACE/artifacts/proposals/pending/{proposalId}.json`. The server
loads this file on the next list / apply request.

## Proposal

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

`type` and `status` valid values are defined by the active **Ontology**
plugin (default `ontology-ddd`). Pull the current ontology types from
`GET /workspaces/:ws/ontology` (when Phase 4+ exposes it), or check the
existing graph via `GET /workspaces/:ws/nodes` to see what types are in use.

## ClarifyTicket (when extract / model finds ambiguity)

```json
{
  "id": "ct-2026-05-12-xyz",
  "workspaceId": "${TELOS_WORKSPACE_ID}",
  "question": "voidTask and cancelTask: same command or distinct?",
  "candidates": [
    {
      "id": "cc-1",
      "description": "Merge — they are aliases",
      "sourceReferences": [{ "sourceId": "src-api", "location": { "uri": "...", "startLine": 12 } }],
      "proposedOperations": [{ "operation": "removeNode", "nodeId": "cmd.cancelTask" }]
    },
    {
      "id": "cc-2",
      "description": "Distinct — they fire different events",
      "sourceReferences": [],
      "proposedOperations": []
    }
  ],
  "status": "pending"
}
```

Write to `$TELOS_WORKSPACE/artifacts/clarify/pending/{ticketId}.json` when
the skill cannot decide. Don't guess — produce a clarify ticket and let a
human resolve it via the Studio UI.

## ID generation

Generate stable, descriptive IDs from inside the skill:

- Proposal: `p-{ISO-date}-{4-char hash}` e.g. `p-2026-05-12-a3f1`
- ClarifyTicket: `ct-{ISO-date}-{4-char hash}`
- New node IDs follow ontology conventions (e.g. ddd uses `cmd.voidTask`,
  `ctx.signup`, etc.)

Use `uuidgen | cut -c1-8` (macOS / Linux) or `head -c 16 /dev/urandom | base64`
to generate the random suffix from bash.

## Atomic writes

The server scans `artifacts/proposals/pending/` and reads any `.json` it
finds. To avoid a partial-write race, write to a `.tmp` first and rename:

```bash
cat > "$tmp" <<EOF
{...}
EOF
mv "$tmp" "$final"
```
