# Telos REST API reference (for skills)

All skills run inside a `claude` subprocess that receives:

- `TELOS_API_URL`: base URL of the running Telos server (e.g. `http://localhost:4321`)
- `TELOS_WORKSPACE`: absolute path to the workspace root directory
- `TELOS_WORKSPACE_ID`: workspace identifier (used in URL path)
- `TELOS_SESSION_DIR`: absolute path to the spawn cwd. Use this when reading shared skill refs (e.g. `$TELOS_SESSION_DIR/.claude/skills/shared/...`); do **not** assume `.claude/skills/` lives under `$TELOS_WORKSPACE`.

Skills query / mutate state by calling these endpoints with `curl`. The full path
template is `${TELOS_API_URL}/workspaces/${TELOS_WORKSPACE_ID}/...`.

## Read-only graph queries

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/workspaces/:ws/model/snapshot` | `{ nodes: [...], edges: [...] }` (full graph) |
| `GET` | `/workspaces/:ws/nodes?type=&status=&q=&limit=&offset=` | `{ items: [GraphNode] }` |
| `GET` | `/workspaces/:ws/nodes/:nodeId` | `GraphNode` |
| `GET` | `/workspaces/:ws/nodes/:nodeId/scope?depth=2` | `{ nodes, edges }` (subgraph) |
| `GET` | `/workspaces/:ws/edges?type=&fromNodeId=&toNodeId=&limit=&offset=` | `{ items: [GraphEdge] }` |

`q` matches `nameContains` (case-insensitive substring on node name).

## HITL artifacts (read)

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/workspaces/:ws/proposals?status=pending&limit=&offset=` | `{ items: [Proposal] }` |
| `GET` | `/workspaces/:ws/proposals/:id` | `Proposal` |
| `GET` | `/workspaces/:ws/clarify?status=pending` | `{ items: [ClarifyTicket] }` |
| `GET` | `/workspaces/:ws/clarify/:id` | `ClarifyTicket` |
| `GET` | `/workspaces/:ws/decisions?action=&limit=&offset=` | `{ items: [Decision] }` |
| `GET` | `/workspaces/:ws/decisions/:id` | `Decision` |

## HITL artifacts (write), usually via filesystem

Skills do **not** mutate state through the API. They write JSON to the
workspace's `artifacts/` directory; the server picks it up on the next read.

| Artifact | Location |
|----------|----------|
| Proposal (new) | `$TELOS_WORKSPACE/artifacts/proposals/pending/{proposalId}.json` |
| ClarifyTicket (new) | `$TELOS_WORKSPACE/artifacts/clarify/pending/{clarifyTicketId}.json` |

Apply / Reject / Answer / Skip transitions happen via the API (route
`POST /proposals/:id/apply`, etc.). Those are triggered by a human in
the UI, not by a skill.

## Error semantics

All endpoints return `application/problem+json` on error:

```json
{ "type": "about:blank", "title": "NotFoundError", "status": 404,
  "code": "TELOS-NOT-FOUND", "detail": "..." }
```

Status codes: 400 (`TELOS-VAL`), 404 (`TELOS-NOT-FOUND`), 409
(`TELOS-CONFLICT`), 500 (`TELOS-INTERNAL`).

## curl conventions in SKILL.md

Use `-s` (silent) + `-f` (fail on 4xx/5xx) when you only want successful
responses. Use `--get --data-urlencode key=value` to encode query strings
safely. Always check that `TELOS_API_URL` and `TELOS_WORKSPACE_ID` are set
before any curl call.
