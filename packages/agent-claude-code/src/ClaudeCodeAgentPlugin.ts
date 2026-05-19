import type { AgentBinding, AgentPlugin } from '@braidhq/core'
import type { AgentBindingDescriptor, AgentKind, PluginId } from '@braidhq/schema'
import { z } from 'zod'
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
export const claudeCodeAgentPlugin: AgentPlugin = Object.freeze({
  id: 'agent.claude-code' as PluginId,
  type: 'agent' as const,
  kind: CLAUDE_CODE_KIND,
  configSchema: z.object({}).passthrough(),
  createBinding: (descriptor: AgentBindingDescriptor): AgentBinding =>
    new ClaudeCodeAgentBinding(descriptor),
})

export { CLAUDE_CODE_KIND }
