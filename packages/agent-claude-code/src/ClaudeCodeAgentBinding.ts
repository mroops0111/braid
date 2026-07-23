import type { AgentBinding, AgentSpawnInput, SpawnInvocation } from '@braidhq/core'
import type { AgentBindingDescriptor, SkillEvent } from '@braidhq/schema'
import process from 'node:process'
import { writeClaudeMcpConfig } from './claudeMcpConfig.js'
import { parseClaudeLine } from './claudeStream.js'

export class ClaudeCodeAgentBinding implements AgentBinding {
  constructor(readonly descriptor: AgentBindingDescriptor) {
    if (descriptor.kind !== 'claude-code') {
      throw new Error(`ClaudeCodeAgentBinding expects kind="claude-code", got "${descriptor.kind}"`)
    }
  }

  async resolveSpawn(input: AgentSpawnInput): Promise<SpawnInvocation> {
    // On resume the prompt is just the user's follow-up text.
    // Claude still holds the conversation context and the slash command,
    // including any extension it read on the first run.
    // On a fresh run, invoke the skill's slash command.
    // When the workspace has an EXTEND.md for this skill,
    // point claude at it rather than inline the text,
    // so the relative *.md links inside it still resolve.
    // The skill id is already `namespace:verb`, which is exactly claude's
    // plugin-skill invocation once the bundles load via `--plugin-dir`.
    const slashCommand = `/${input.skillId} ${input.args}`
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
    if (input.mcpServers.length > 0) {
      const mcpConfigFile = await writeClaudeMcpConfig(input.sessionDir, input.workspace.id, input.mcpServers)
      baseArgs.push('--mcp-config', mcpConfigFile)
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
      ...filterEnv(process.env),
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

function filterEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string')
      result[key] = value
  }
  return result
}
