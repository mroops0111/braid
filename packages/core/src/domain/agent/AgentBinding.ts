import type { AbsolutePath, AgentBindingDescriptor, McpServerConfig, SkillEvent, SkillId } from '@braidhq/schema'
import type { SkillManifest } from '../skill/SkillManifest.js'
import type { Workspace } from '../workspace/Workspace.js'

export interface SpawnInvocation {
  readonly bin: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

export interface AgentSpawnInput {
  readonly skillId: SkillId
  readonly args: string
  readonly workspace: Workspace
  readonly manifest: SkillManifest
  readonly apiUrl: string
  // The MCP servers to expose to the agent, the built-in gateway plus any the
  // workspace declares. The binding wires them however its CLI expects, writing
  // config under `sessionDir` when it needs a file.
  readonly mcpServers: readonly McpServerConfig[]
  readonly sessionDir: AbsolutePath
  // Directories, each a self-contained bundle of the workspace's invokable
  // skills for one namespace. The binding loads them however its CLI expects,
  // claude via `--plugin-dir`, so a skill invokes as `/namespace:verb`.
  readonly skillBundleDirs: readonly string[]
  // Session id to continue, when the agent supports resuming a conversation.
  readonly resumeSessionId?: string
}

export interface AgentBinding {
  readonly descriptor: AgentBindingDescriptor
  // Build the spawn command, wiring MCP in whatever form the agent's CLI needs.
  resolveSpawn: (input: AgentSpawnInput) => Promise<SpawnInvocation>
  // Map one line of the agent's stdout into zero or more SkillEvents.
  // The agent's output format is its own concern, not the runner's.
  parseLine: (line: string, now: string) => SkillEvent[]
}
