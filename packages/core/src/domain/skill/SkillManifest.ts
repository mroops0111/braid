import type {
  AbsolutePath,
  McpServerId,
  SkillFrontmatter,
  SkillId,
  SkillManifest as SkillManifestData,
  SkillOrigin,
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
    return this.data.frontmatter.requiredMcpServers.includes(serverId)
  }

  readinessIssuesFor(workspace: Workspace, env: Readonly<Record<string, string | undefined>>): readonly SkillReadinessIssue[] {
    const issues: SkillReadinessIssue[] = []
    for (const name of this.data.frontmatter.requiredEnv) {
      if (!env[name]) {
        issues.push({ kind: 'missing-env', target: name })
      }
    }
    for (const serverId of this.data.frontmatter.requiredMcpServers) {
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
