import type { AgentBinding, AgentMessage, AgentSpawnInput, SpawnInvocation } from '@braidhq/core'
import type { AgentBindingDescriptor, SkillEvent } from '@braidhq/schema'
import process from 'node:process'
import { inheritableSpawnEnvironment } from '@braidhq/core'
import { writeClaudeMcpConfig } from './claudeMcpConfig.js'
import { parseClaudeLine } from './claudeStream.js'

export class ClaudeCodeAgentBinding implements AgentBinding {
  constructor(readonly descriptor: AgentBindingDescriptor) {
    if (descriptor.kind !== 'claude-code') {
      throw new Error(`ClaudeCodeAgentBinding expects kind="claude-code", got "${descriptor.kind}"`)
    }
  }

  async resolveSpawn(input: AgentSpawnInput): Promise<SpawnInvocation> {
    // Claude keeps the conversation itself,
    // so a continued run sends only the new turn,
    // and the earlier exchange stays where it already is.
    // Without that handle the exchange travels in the prompt,
    // which a binding for an agent holding no conversation state always does.
    const promptArg = input.conversationId
      ? latestTurn(input.messages)
      : openingPrompt(input)
    const baseArgs: string[] = [
      '-p',
      promptArg,
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--model',
      this.descriptor.model,
    ]
    if (input.conversationId) {
      baseArgs.push('--resume', input.conversationId)
    }
    if (this.descriptor.effort) {
      baseArgs.push('--effort', this.descriptor.effort)
    }
    if (input.mcpServers.length > 0) {
      const mcpConfigFile = await writeClaudeMcpConfig(input.sessionDir, input.workspace.id, input.mcpServers)
      // Strict, so the run sees only braid's servers,
      // not the operator's global ~/.claude.json MCP servers merged in.
      baseArgs.push('--mcp-config', mcpConfigFile, '--strict-mcp-config')
    }
    // Load each namespace's skill bundle, so `/namespace:verb` resolves.
    for (const bundleDir of input.skillBundleDirs) {
      baseArgs.push('--plugin-dir', bundleDir)
    }
    for (const dir of input.workspace.resolveAddDirs()) {
      baseArgs.push('--add-dir', dir)
    }
    for (const extra of this.descriptor.extraArgs) {
      baseArgs.push(extra)
    }

    const env: Record<string, string> = {
      ...inheritableSpawnEnvironment(process.env),
      // The credential arrives here rather than being inherited,
      // so one place decides which account a run spends,
      // and a run without one fails saying so.
      ...this.descriptor.env,
      BRAID_WORKSPACE: input.workspace.rootPath,
      BRAID_WORKSPACE_ID: input.workspace.id,
      BRAID_API_URL: input.apiUrl,
    }

    return { bin: 'claude', args: baseArgs, env }
  }

  // Claude streams newline-delimited JSON, so the runner hands each line here.
  parseLine = (line: string, now: string): SkillEvent[] => parseClaudeLine(line, now)
}

function latestTurn(messages: readonly AgentMessage[]): string {
  return messages.at(-1)?.content ?? ''
}

/**
 * The prompt that opens a claude conversation.
 *
 * A skill is invoked as a slash command,
 * so the first user message becomes its argument.
 * A skill with an EXTEND.md is pointed at the file rather than inlining it,
 * so the `*.md` links inside it still resolve.
 *
 * Anything after that first message is an exchange claude has not seen,
 * which only happens when the caller holds the conversation,
 * and we have no handle for it.
 * Replaying it in the prompt is why the port carries messages at all.
 */
function openingPrompt(input: AgentSpawnInput): string {
  const [opening, ...rest] = input.messages
  const slashCommand = `/${input.skillId} ${opening?.content ?? ''}`
  const extensionPath = input.manifest.extensionPath
  const head = extensionPath
    ? `${slashCommand}\n\nThis workspace extends this skill. Read and follow ${extensionPath} before you begin.`
    : slashCommand
  if (rest.length === 0)
    return head
  const transcript = rest
    .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n')
  return `${head}\n\nThe conversation so far, which you did not see:\n\n${transcript}`
}
