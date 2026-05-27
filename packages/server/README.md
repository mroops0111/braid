# @braidhq/server

REST + SSE server for Braid. Hono-based, with an OpenAPI 3 spec
exposed at `GET /openapi.json` for any consumer that wants typed
access to the graph operations.

## openapi-mcp-gateway Integration

Skills shipped with `@braidhq/core` and `@braidhq/ontology-ddd` invoke
the server through MCP tools, not curl. The wiring runs the gateway
as a **per-skill stdio child of claude** — no long-running HTTP
server, gateway lifecycle tracks the skill run automatically.

```
┌──────────────────┐   /openapi.json    ┌─────────────────────┐
│ @braidhq/server  │ ◀───── HTTP ────── │ openapi-mcp-gateway │
│ (this package)   │ ────── REST  ────▶ │ (uvx, stdio child)  │
└──────────────────┘                    └─────────────────────┘
                                                   ▲ stdin/stdout
                                                   │ MCP
                                        ┌─────────────────────┐
                                        │ spawned claude      │
                                        │ subprocess (skill)  │
                                        └─────────────────────┘
```

### 1. Install `uv` (one-time setup)

`openapi-mcp-gateway` is a Python package distributed via PyPI. The
gateway is launched on demand by claude via `uvx` (UV's "run an
ephemeral package" command), so the only thing you have to install
locally is the `uv` runtime itself:

```bash
# macOS
brew install uv
# linux / windows: see https://docs.astral.sh/uv/getting-started/installation/
```

The Braid server **preflight-checks for `uv` at boot**. If it's not
found, you'll see:

```
[braid] `uv` not found on PATH; the built-in braid-core MCP gateway
        will not be available. Install via `brew install uv` or
        https://docs.astral.sh/uv/ to enable.
```

Skills with `requiredMcpServers: ['braid-core']` will then surface
as not-ready in Studio's sidebar. Other skills keep working.

### 2. That's it

No environment variables to set, no separate gateway process to run.
When Braid spawns a skill, the skill's mcp-config gets a stdio entry:

```jsonc
{
  "braid-core": {
    "type": "stdio",
    "command": "uvx",
    "args": [
      "openapi-mcp-gateway",
      "--spec",
      "http://127.0.0.1:4321/openapi.json",
      "--transport",
      "stdio",
      "--name",
      "braid-core"
    ]
  }
}
```

claude spawns the gateway, the gateway pulls the spec from the
running Braid server, and the REST surface becomes MCP tools for the
duration of the skill run.

First-time runs take an extra ~1–2 seconds (uvx caches
`openapi-mcp-gateway` under `~/.cache/uv/`). Subsequent runs hit the
cache.

### 3. Author skills against the MCP tools

Skill prompts call MCP tools by their `operationId`:

- `braid_search_nodes(workspaceId, q, type?, status?, limit?, offset?)`
- `braid_get_scope(workspaceId, nodeId, depth)`
- `braid_get_ontology(workspaceId)`
- `braid_submit_proposal(workspaceId, operations, generatedBy, rationale)`
- `braid_submit_clarify(workspaceId, question, candidates)`
- `braid_mark_clarify_applied(workspaceId, clarifyTicketId, status, userId, proposalId?)`
- …and the rest, one per operation in `/openapi.json`.

Exact tool names depend on `openapi-mcp-gateway`'s naming convention
(typically `<server-name>_<operationId>` with snake_case
normalisation). Inspect the spec or the gateway's `tools/list`
response to see live names.

### Pinning the uv binary

For reproducibility (e.g. CI environments with multiple Python
toolchains) you can pin a specific `uvx` binary via the
`BRAID_UVX_BIN` env var. composeFs preflight-checks the pinned
binary; if it's not executable, the gateway entry is skipped same as
when `uv` is missing entirely.

```bash
export BRAID_UVX_BIN=/opt/homebrew/bin/uvx
```

### Forward compatibility (hosted Braid)

When Braid grows a hosted product where the server runs remotely:

- If claude runs locally (desktop spawns it): the stdio path above
  still works. The local gateway just talks HTTPS to the remote
  `/openapi.json` and REST endpoints, with auth headers passed
  through workspace-level MCP server config.
- If claude runs in the cloud (browser Studio): the stdio path runs
  server-side, gateway loopbacks to the local server.

The `streamable-http` MCP transport stays first-class in the schema
so workspaces can declare any third-party HTTP MCP server (Redmine /
Notion / Linear / …) alongside the stdio braid-core. The two
transports are not mutually exclusive.

## Routes That Are Not in the Spec

- SSE streams (`/workspaces/{ws}/runs/{runId}/events`,
  `/workspaces/{ws}/events`) — not invocable as one-shot MCP tools.
- OAuth callbacks (`/oauth/google/callback`) — HTML response.
- Workspace management (`/workspaces/*`) — admin surface for CLI
  and Studio, not for skills.

The `GET /openapi.json` test in `test/app.test.ts` pins this list.
