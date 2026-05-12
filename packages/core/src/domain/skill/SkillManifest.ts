import type {
  AbsolutePath,
  ClaudeCodeSkillFrontmatter,
  McpServerId,
  SkillFrontmatter,
  SkillId,
  SkillManifest as SkillManifestData,
  SkillOrigin,
  TelosSkillExtension,
} from '@telos/schema'
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
    const { telos: _telos, ...claudeFields } = this.data.frontmatter
    return claudeFields
  }

  /** Telos-only extension fields under the `telos:` namespace. */
  get telosFields(): TelosSkillExtension {
    return this.data.frontmatter.telos
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
    return this.telosFields.requiredMcpServers.includes(serverId)
  }

  readinessIssuesFor(workspace: Workspace, env: Readonly<Record<string, string | undefined>>): readonly SkillReadinessIssue[] {
    const issues: SkillReadinessIssue[] = []
    for (const name of this.telosFields.requiredEnv) {
      if (!env[name]) {
        issues.push({ kind: 'missing-env', target: name })
      }
    }
    for (const serverId of this.telosFields.requiredMcpServers) {
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
