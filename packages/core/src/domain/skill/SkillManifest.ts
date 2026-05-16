import type {
  AbsolutePath,
  BraidSkillExtension,
  ClaudeCodeSkillFrontmatter,
  McpServerId,
  SkillFrontmatter,
  SkillId,
  SkillManifest as SkillManifestData,
  SkillOrigin,
} from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

export interface SkillReadinessIssue {
  readonly kind: 'missing-env' | 'missing-path' | 'missing-mcp-server'
  readonly target: string
}

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

  /** Claude Code-recognised frontmatter fields (name, description, argument-hint, …). */
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

  readinessIssuesFor(workspace: Workspace, env: Readonly<Record<string, string | undefined>>): readonly SkillReadinessIssue[] {
    const issues: SkillReadinessIssue[] = []
    for (const name of this.braidFields.requiredEnv) {
      if (!env[name]) {
        issues.push({ kind: 'missing-env', target: name })
      }
    }
    for (const serverId of this.braidFields.requiredMcpServers) {
      if (!workspace.findMcpServer(serverId)) {
        issues.push({ kind: 'missing-mcp-server', target: serverId })
      }
    }
    return issues
  }

  toData(): SkillManifestData {
    return this.data
  }
}
