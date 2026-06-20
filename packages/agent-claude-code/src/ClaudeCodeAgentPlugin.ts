import type { AgentPlugin } from '@braidhq/core'
import type { AgentKind } from '@braidhq/schema'
import { defineAgentPlugin } from '@braidhq/sdk'
import { ClaudeCodeAgentBinding } from './ClaudeCodeAgentBinding.js'

const CLAUDE_CODE_KIND = 'claude-code' as AgentKind

/**
 * AgentPlugin wrapper for the Claude Code subprocess binding. Composition
 * root registers this against `PluginRegistry`; `composeFsApp` looks up
 * the active agent kind from `workspace.agentBindings[]` rather than
 * `import`-ing `ClaudeCodeAgentBinding` directly. Other agents
 * (anthropic-api, cursor, ollama, codex, ...) register the same way
 * under a different `kind`.
 */
export const claudeCodeAgentPlugin: AgentPlugin = defineAgentPlugin({
  kind: CLAUDE_CODE_KIND,
  createBinding: descriptor => new ClaudeCodeAgentBinding(descriptor),
})

export { CLAUDE_CODE_KIND }
