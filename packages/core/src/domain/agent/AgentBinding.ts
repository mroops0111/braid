import type { AbsolutePath, AgentBindingDescriptor, SkillId } from '@braidhq/schema'
import type { SkillManifest } from '../skill/SkillManifest.js'
import type { Workspace } from '../workspace/Workspace.js'

export interface SpawnInvocation {
  readonly bin: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly mcpConfigFile?: AbsolutePath
}

export interface AgentSpawnInput {
  readonly skillId: SkillId
  readonly args: string
  readonly workspace: Workspace
  readonly manifest: SkillManifest
  readonly apiUrl: string
  readonly mcpConfigFile?: AbsolutePath
  /** Claude session id to continue (sets `--resume <id>` on the spawn). */
  readonly resumeSessionId?: string
}

export interface AgentBinding {
  readonly descriptor: AgentBindingDescriptor
  resolveSpawn: (input: AgentSpawnInput) => SpawnInvocation
}
