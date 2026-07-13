import type { AgentBinding, AgentSpawnInput, SpawnInvocation } from '@braidhq/core'
import type { AgentBindingDescriptor } from '@braidhq/schema'
import process from 'node:process'

export class ClaudeCodeAgentBinding implements AgentBinding {
  constructor(readonly descriptor: AgentBindingDescriptor) {
    if (descriptor.kind !== 'claude-code') {
      throw new Error(`ClaudeCodeAgentBinding expects kind="claude-code", got "${descriptor.kind}"`)
    }
  }

  resolveSpawn(input: AgentSpawnInput): SpawnInvocation {
    // When resuming, the prompt is just the user's follow-up text.
    // claude already holds the conversation context and the slash command,
    // including any extension it read on the first run. Fresh run, invoke the skill's slash command.
    // When the workspace has an EXTEND.md for this skill, point claude at it rather than inline the text,
    // so its relative references/*.md links still resolve.
    const slashCommand = `/${input.manifest.frontmatter.name} ${input.args}`
    const extensionPath = input.manifest.extensionPath
    const promptArg = input.resumeSessionId
      ? input.args
      : extensionPath
        ? `${slashCommand}\n\nThis workspace extends this skill. Read and follow ${extensionPath} before you begin.`
        : slashCommand
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
    if (input.resumeSessionId) {
      baseArgs.push('--resume', input.resumeSessionId)
    }
    if (this.descriptor.effort) {
      baseArgs.push('--effort', this.descriptor.effort)
    }
    if (input.mcpConfigFile) {
      baseArgs.push('--mcp-config', input.mcpConfigFile)
    }
    for (const dir of input.workspace.resolveAddDirs()) {
      baseArgs.push('--add-dir', dir)
    }
    for (const extra of this.descriptor.extraArgs) {
      baseArgs.push(extra)
    }

    const env: Record<string, string> = {
      ...filterEnv(process.env),
      ...this.descriptor.env,
      BRAID_WORKSPACE: input.workspace.rootPath,
      BRAID_WORKSPACE_ID: input.workspace.id,
      BRAID_API_URL: input.apiUrl,
    }

    const invocation: SpawnInvocation = input.mcpConfigFile
      ? { bin: 'claude', args: baseArgs, env, mcpConfigFile: input.mcpConfigFile }
      : { bin: 'claude', args: baseArgs, env }
    return invocation
  }
}

function filterEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string')
      result[key] = value
  }
  return result
}
