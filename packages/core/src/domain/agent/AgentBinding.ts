import type { AbsolutePath, AgentBindingDescriptor, McpServerConfig, SkillEvent, SkillId } from '@braidhq/schema'
import type { SkillManifest } from '../skill/SkillManifest.js'
import type { Workspace } from '../workspace/Workspace.js'

export interface SpawnInvocation {
  readonly bin: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/** One turn of a conversation, in the form every agent can read. */
export interface AgentMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

export interface AgentSpawnInput {
  readonly skillId: SkillId
  /**
   * The conversation this turn continues, oldest first, ending with the user
   * message that starts this run. A binding holding no conversation state of
   * its own has everything it needs here, which is what keeps the port free of
   * any one agent's idea of a session.
   */
  readonly messages: readonly AgentMessage[]
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
  /**
   * A handle the agent itself gave us for this conversation, from a prior
   * `session-started`. A binding that recognises one may continue that
   * conversation rather than replaying `messages`. That is an optimisation an
   * agent may offer, never something the caller relies on, so a binding
   * without it stays correct by reading `messages`.
   */
  readonly conversationId?: string
}

export interface AgentBinding {
  readonly descriptor: AgentBindingDescriptor
  // Build the spawn command, wiring MCP in whatever form the agent's CLI needs.
  resolveSpawn: (input: AgentSpawnInput) => Promise<SpawnInvocation>
  // Map one line of the agent's stdout into zero or more SkillEvents.
  // The agent's output format is its own concern, not the runner's.
  parseLine: (line: string, now: string) => SkillEvent[]
}
