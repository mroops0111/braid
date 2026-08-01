# @braidhq/agent-claude-code

Braid runs each skill by spawning a coding agent as a subprocess. `@braidhq/agent-claude-code` is the default agent. It drives the `claude` CLI, turning a SKILL.md prompt into a stream of graph events, and it keeps everything Claude-specific out of the rest of Braid.

## Role

The package is the Claude Code adapter behind core's `AgentBinding` port. Core knows how to orchestrate an agent, this package knows how to talk to one.

- **The Binding**: `resolveSpawn` builds the `claude` command line and environment for a skill run, and `parseLine` maps each output line back into a `SkillEvent`.
- **The Plugin**: An `AgentPlugin` that registers the binding under the `claude-code` kind, so the composition root selects it by config rather than by import.
- **The Claude Specifics**: The `--mcp-config` file shape and the `stream-json` envelope parsing, the two things that would differ for any other agent.

## Structure

The package is flat. Every module sits under `src/` and re-exports through `index.ts`.

```
src/
├── ClaudeCodeAgentPlugin.ts   the AgentPlugin, registered by kind
├── ClaudeCodeAgentBinding.ts  resolveSpawn and parseLine
├── claudeMcpConfig.ts         the `--mcp-config` file claude reads
├── claudeStream.ts            one stream-json line into SkillEvents
└── index.ts
```

- **ClaudeCodeAgentPlugin**: The thin `defineAgentPlugin` wrapper. Its `createBinding` hands back one `ClaudeCodeAgentBinding` per server.
- **ClaudeCodeAgentBinding**: Assembles the spawn command, prompt or resume, model, effort, MCP config, and add-dirs, then threads `parseLine` into the runner's drain loop.
- **claudeMcpConfig**: Builds and writes the JSON `claude --mcp-config` expects, translating Braid's MCP server config and resolving `${VAR}` references from the environment.
- **claudeStream**: A pure parser from one `claude` stream-json line to zero or more `SkillEvent`s.

## Boundaries

- **Claude Lives Here**: Every Claude-specific detail, the CLI flags, the MCP config shape, the stream-json envelopes, is confined to this package. Core and server stay agent-agnostic.
- **One Port**: The only contract with Braid is core's `AgentBinding` and `AgentPlugin`. A different agent, such as anthropic-api, cursor, or codex, is a sibling package implementing the same port.
- **Wiring Elsewhere**: The composition root registers the plugin and picks the active kind. Nothing here is imported directly by server code.
- **Pure Parsing**: `parseLine` does no I/O and reads no clock, the timestamp is passed in, so a line maps to events deterministically under test.

## Dependencies

- **Depends On**: `@braidhq/core` for the port types, `@braidhq/schema` for `SkillEvent` and the config shapes, and `@braidhq/sdk` for `defineAgentPlugin`.
- **Consumed By**: `server`, at its composition root, as the default agent bundle.
