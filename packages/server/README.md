# @braidhq/server

REST + SSE server for Braid. Hono-based, with an OpenAPI 3 spec
exposed at `GET /openapi.json` for any consumer that wants typed
access to the graph operations.

## openapi-mcp-gateway integration

Skills shipped with `@braidhq/core` and `@braidhq/ontology-ddd` invoke
the server through MCP tools, not curl. The wiring is:

```
┌────────────┐   /openapi.json   ┌─────────────────────┐
│ @braidhq/   │ ───────────────▶ │ openapi-mcp-gateway │
│ server     │                   │ (Python, separate    │
│            │ ◀──────────────── │  process)            │
└────────────┘   REST calls      └─────────────────────┘
                                            │ MCP (Streamable HTTP)
                                            ▼
                                  ┌─────────────────────┐
                                  │ spawned claude      │
                                  │ subprocess (skill)  │
                                  └─────────────────────┘
```

### 1. Run the gateway (one-time setup)

`openapi-mcp-gateway` is a Python package published to PyPI. Install
the `uv` runtime if you don't already have it:

```bash
# macOS
brew install uv
# linux / windows: see https://docs.astral.sh/uv/getting-started/installation/
```

Run the gateway pointing at the Braid server's OpenAPI spec:

```bash
uvx openapi-mcp-gateway \
  --spec http://127.0.0.1:4321/openapi.json \
  --name braid-core
```

The gateway exposes a Streamable HTTP MCP endpoint at
`http://127.0.0.1:8000/braid-core/mcp`.

### 2. Point Braid at the gateway

When the server boots, it injects a `braid-core` MCP server entry
into every spawned skill if `BRAID_MCP_GATEWAY_URL` is set:

```bash
export BRAID_MCP_GATEWAY_URL="http://127.0.0.1:8000/braid-core/mcp"
pnpm --filter @braidhq/server dev
```

Spawned skills then see `braid-core` alongside whatever
workspace-level MCP servers the user has declared in `PRODUCT.md`.

### 3. Author skills against the MCP tools

Skill prompts call MCP tools by their `operationId`:

- `braid_search_nodes(workspaceId, q, type?, status?, limit?, offset?)`
- `braid_get_scope(workspaceId, nodeId, depth)`
- `braid_get_ontology(workspaceId)`
- `braid_submit_proposal(workspaceId, operations, generatedBy, rationale)`
- `braid_submit_clarify(workspaceId, question, candidates)`
- `braid_mark_clarify_applied(workspaceId, clarifyTicketId, status, userId, proposalId?)`
- …and the rest, one per operation in `/openapi.json`.

The exact tool names depend on `openapi-mcp-gateway`'s naming
convention (typically `<server-name>_<operationId>` with snake_case
normalisation). Inspect the spec or the gateway's `tools/list`
response to see the live names.

### Without the gateway

If `BRAID_MCP_GATEWAY_URL` is unset, skills don't see the
`braid-core` MCP server and have to fall back to curl against the
REST endpoints directly. This works but loses the typed tool
contract; reserve it for "just trying things out" scenarios.

## Routes that are not in the spec

- SSE streams (`/workspaces/{ws}/runs/{runId}/events`,
  `/workspaces/{ws}/events`) — they're not invocable as one-shot
  MCP tools.
- OAuth callbacks (`/oauth/google/callback`) — HTML response.
- Workspace management (`/workspaces/*`) — admin surface for CLI
  and Studio, not for skills.

The `GET /openapi.json` test in `test/app.test.ts` pins this list.
