import type {
  AbsolutePath,
  BraidSkillExtension,
  ClaudeCodeSkillFrontmatter,
  McpServerId,
  SkillAvailabilityIssue,
  SkillFrontmatter,
  SkillId,
  SkillManifest as SkillManifestData,
  SkillOrigin,
} from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

export class SkillManifest {
  constructor(private readonly data: SkillManifestData) {}

  get id(): SkillId {
    return this.data.id
  }

  get origin(): SkillOrigin {
    return this.data.origin
  }

  get path(): AbsolutePath {
    return this.data.path
  }

  get frontmatter(): SkillFrontmatter {
    return this.data.frontmatter
  }

  /** Claude Code-recognised frontmatter fields, e.g. name, description, argument-hint. */
  get claudeCodeFields(): ClaudeCodeSkillFrontmatter {
    const { braid: _braid, ...claudeFields } = this.data.frontmatter
    return claudeFields
  }

  /** Braid-only extension fields under the `braid:` namespace. */
  get braidFields(): BraidSkillExtension {
    return this.data.frontmatter.braid
  }

  get extensionPath(): AbsolutePath | undefined {
    return this.data.extensionPath
  }

  isBuiltin(): boolean {
    return this.data.origin === 'builtin'
  }

  isExtended(): boolean {
    return this.data.extensionPath !== undefined
  }

  requiresMcpServer(serverId: McpServerId): boolean {
    return this.braidFields.requiredMcpServers.includes(serverId)
  }

  /**
   * Why this skill cannot run in this workspace, though it may in others.
   *
   * Answered from what the workspace declares, so it is settled as the list is built.
   * What a run's own environment supplies belongs to a later moment,
   * and is asserted by `assertSkillCanStart` instead.
   */
  availabilityIssuesIn(workspace: Workspace): readonly SkillAvailabilityIssue[] {
    return this.braidFields.requiredMcpServers
      .filter(serverId => !workspace.findMcpServer(serverId))
      .map(serverId => ({ kind: 'missing-mcp-server' as const, target: serverId }))
  }

  toData(): SkillManifestData {
    return this.data
  }
}
