import type { AgentPlugin } from '@braidhq/core'
import type { AgentKind } from '@braidhq/schema'
import { defineAgentPlugin } from '@braidhq/sdk'
import { ClaudeCodeAgentBinding } from './ClaudeCodeAgentBinding.js'

const CLAUDE_CODE_KIND = 'claude-code' as AgentKind

/**
 * AgentPlugin wrapper for the Claude Code subprocess binding.
 * The composition root registers it against the PluginRegistry,
 * and composeFsApp builds one server-wide binding for the active agent,
 * rather than importing ClaudeCodeAgentBinding directly.
 * Other agents, such as anthropic-api, cursor, ollama, or codex,
 * register the same way under a different kind.
 */
export const claudeCodeAgentPlugin: AgentPlugin = defineAgentPlugin({
  kind: CLAUDE_CODE_KIND,
  createBinding: descriptor => new ClaudeCodeAgentBinding(descriptor),
})

export { CLAUDE_CODE_KIND }
