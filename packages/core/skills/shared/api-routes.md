# Braid REST API reference (for skills)

All skills run inside a `claude` subprocess that receives:

- `BRAID_API_URL`: base URL of the running Braid server (e.g. `http://localhost:4321`)
- `BRAID_WORKSPACE`: absolute path to the workspace root directory
- `BRAID_WORKSPACE_ID`: workspace identifier (used in URL path)
- `BRAID_SESSION_DIR`: absolute path to the spawn cwd. Use this when reading shared skill refs (e.g. `$BRAID_SESSION_DIR/.claude/skills/shared/...`); do **not** assume `.claude/skills/` lives under `$BRAID_WORKSPACE`.

Skills query / mutate state by calling these endpoints with `curl`. The full path
template is `${BRAID_API_URL}/workspaces/${BRAID_WORKSPACE_ID}/...`.

## Read-only graph queries

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/workspaces/:ws/model/snapshot` | `{ nodes: [...], edges: [...] }` (full graph) |
| `GET` | `/workspaces/:ws/nodes?type=&status=&q=&limit=&offset=` | `{ items: [GraphNode] }` |
| `GET` | `/workspaces/:ws/nodes/:nodeId` | `GraphNode` |
| `GET` | `/workspaces/:ws/nodes/:nodeId/scope?depth=2` | `{ nodes, edges }` (subgraph) |
| `GET` | `/workspaces/:ws/edges?type=&fromNodeId=&toNodeId=&limit=&offset=` | `{ items: [GraphEdge] }` |

`q` matches `nameContains` (case-insensitive substring on node name).

## Ontology

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/workspaces/:ws/ontology` | `{ ontologyId, nodeTypes: NodeTypeDescriptor[], edgeTypes: EdgeTypeDescriptor[] }` |

Single source of truth for the valid `node.type` / `edge.type` values. Skills MUST call this and use the returned ids verbatim (case-sensitive). Adding a new type happens in the ontology plugin; both this endpoint and the server-side validator pick it up automatically.

## HITL artifacts (read)

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/workspaces/:ws/proposals?status=pending&limit=&offset=` | `{ items: [Proposal] }` |
| `GET` | `/workspaces/:ws/proposals/:id` | `Proposal` |
| `GET` | `/workspaces/:ws/proposals/:id/validate` | `{ ok: boolean, issues: ValidationIssue[] }` (dry-run; no state change) |
| `GET` | `/workspaces/:ws/clarify?status=pending` | `{ items: [ClarifyTicket] }` |
| `GET` | `/workspaces/:ws/clarify/:id` | `ClarifyTicket` |
| `GET` | `/workspaces/:ws/decisions?action=&limit=&offset=` | `{ items: [Decision] }` |
| `GET` | `/workspaces/:ws/decisions/:id` | `Decision` |

`/proposals/:id/validate` runs the same validators the apply path runs. Useful for debugging an existing proposal or for tools that don't want to commit yet; for skill writes prefer `POST /proposals` which validates inline.

## HITL artifacts (write)

Skills create artifacts via these endpoints. The server validates the body, mints the id, stamps `generatedAt`, and persists. **Do not write JSON files directly under `artifacts/` from a skill.**

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/workspaces/:ws/proposals` | `ProposalDraft` (`operations`, `generatedBy`, `rationale`, optional `externalReferences`) | `201 Proposal` on success; `400 { issues: [...] }` on validation failure |
| `POST` | `/workspaces/:ws/clarify` | `ClarifyDraft` (`question`, `candidates`, optional `externalReferences`) | `201 ClarifyTicket` |

`POST /proposals` runs the same validators as Apply; a 400 response carries `issues` so the skill can fix the body and retry (cap at 3 rounds, then surface remaining issues to the user). Candidates' `proposedOperations` inside a clarify ticket are validated only when a user later picks one via `POST /clarify/:id/answer`.

Apply / Reject / Answer / Skip transitions happen via the API (route `POST /proposals/:id/apply`, etc.) and are triggered by a human in the UI, not by a skill.

## Error semantics

All endpoints return `application/problem+json` on error:

```json
{ "type": "about:blank", "title": "NotFoundError", "status": 404,
  "code": "BRAID-NOT-FOUND", "detail": "..." }
```

Status codes: 400 (`BRAID-VAL`), 404 (`BRAID-NOT-FOUND`), 409
(`BRAID-CONFLICT`), 500 (`BRAID-INTERNAL`).

## curl conventions in SKILL.md

Use `-s` (silent) + `-f` (fail on 4xx/5xx) when you only want successful
responses. Use `--get --data-urlencode key=value` to encode query strings
safely. Always check that `BRAID_API_URL` and `BRAID_WORKSPACE_ID` are set
before any curl call.
