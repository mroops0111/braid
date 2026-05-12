import type {
  AbsolutePath,
  AgentId,
  McpServerId,
  ProductManifest,
  SkillId,
  SkillManifest as SkillManifestData,
  SourceId,
  StorageKind,
  Workspace as WorkspaceData,
  WorkspaceId,
} from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { SkillManifest, Workspace } from '../../../src/index.js'

function workspace(overrides?: { withMcpServer?: McpServerId | false }): Workspace {
  const mcpServers
    = overrides?.withMcpServer === false
      ? []
      : [{
          id: (overrides?.withMcpServer ?? ('redmine' as McpServerId)),
          transport: 'stdio' as const,
          command: 'npx',
          args: [],
          env: {},
        }]

  const productManifest: ProductManifest = {
    name: 'demo',
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: { default: 'claude-default', tasks: {} },
    agentBindings: [{
      id: 'claude-default' as AgentId,
      kind: 'claude-code' as never,
      model: 'opus',
      extraArgs: [],
      env: {},
    }],
    sources: [{
      kind: 'filesystem',
      id: 'src-a' as SourceId,
      role: 'code',
      name: 'a',
      path: '/abs/code' as AbsolutePath,
    }],
    mcpServers,
    storage: { kind: 'neo4j' as StorageKind, config: {} },
    channels: [],
  }

  const data: WorkspaceData = {
    id: 'w-1' as WorkspaceId,
    rootPath: '/abs' as AbsolutePath,
    productManifest,
    pluginConfig: { plugins: [] },
  }
  return new Workspace(data)
}

function manifestData(overrides: Partial<SkillManifestData> = {}): SkillManifestData {
  return {
    id: 'ask' as SkillId,
    origin: 'builtin',
    path: '/abs/ask/SKILL.md' as AbsolutePath,
    frontmatter: {
      name: 'telos-ask',
      description: 'answer questions',
      disableModelInvocation: false,
      telos: {
        requiredEnv: [],
        requiredPaths: [],
        requiredMcpServers: [],
      },
    },
    ...overrides,
  }
}

describe('SkillManifest', () => {
  it('exposes data fields', () => {
    const manifest = new SkillManifest(manifestData())
    expect(manifest.id).toBe('ask')
    expect(manifest.origin).toBe('builtin')
    expect(manifest.path).toBe('/abs/ask/SKILL.md')
    expect(manifest.frontmatter.name).toBe('telos-ask')
  })

  describe('isBuiltin / isExtended', () => {
    it('isBuiltin true for builtin origin', () => {
      expect(new SkillManifest(manifestData()).isBuiltin()).toBe(true)
    })

    it('isBuiltin false for workspace origin', () => {
      expect(new SkillManifest(manifestData({ origin: 'workspace' })).isBuiltin()).toBe(false)
    })

    it('isExtended true when extensionPath set', () => {
      const m = new SkillManifest(manifestData({ extensionPath: '/abs/extend' as AbsolutePath }))
      expect(m.isExtended()).toBe(true)
    })

    it('isExtended false when extensionPath unset', () => {
      expect(new SkillManifest(manifestData()).isExtended()).toBe(false)
    })
  })

  describe('requiresMcpServer', () => {
    it('returns true when server id is listed', () => {
      const m = new SkillManifest(manifestData({
        frontmatter: {
          name: 'x',
          description: 'y',
          disableModelInvocation: false,
          telos: {
            requiredEnv: [],
            requiredPaths: [],
            requiredMcpServers: ['redmine' as McpServerId],
          },
        },
      }))
      expect(m.requiresMcpServer('redmine' as McpServerId)).toBe(true)
      expect(m.requiresMcpServer('xwiki' as McpServerId)).toBe(false)
    })
  })

  describe('claudeCodeFields / telosFields split', () => {
    it('claudeCodeFields strips the telos namespace', () => {
      const m = new SkillManifest(manifestData())
      expect(m.claudeCodeFields).toEqual({
        name: 'telos-ask',
        description: 'answer questions',
        disableModelInvocation: false,
      })
    })

    it('telosFields returns the telos extension block', () => {
      const m = new SkillManifest(manifestData({
        frontmatter: {
          name: 'telos-ask',
          description: 'a',
          disableModelInvocation: false,
          telos: {
            requiredEnv: ['JIRA_TOKEN'],
            requiredPaths: ['intent'],
            requiredMcpServers: ['redmine' as McpServerId],
          },
        },
      }))
      expect(m.telosFields.requiredEnv).toEqual(['JIRA_TOKEN'])
    })
  })

  describe('readinessIssuesFor', () => {
    it('returns no issues when everything is satisfied', () => {
      const m = new SkillManifest(manifestData({
        frontmatter: {
          name: 'x',
          description: 'y',
          disableModelInvocation: false,
          telos: {
            requiredEnv: ['TELOS_API_URL'],
            requiredPaths: [],
            requiredMcpServers: ['redmine' as McpServerId],
          },
        },
      }))
      const issues = m.readinessIssuesFor(workspace(), { TELOS_API_URL: 'http://localhost' })
      expect(issues).toEqual([])
    })

    it('reports missing env vars', () => {
      const m = new SkillManifest(manifestData({
        frontmatter: {
          name: 'x',
          description: 'y',
          disableModelInvocation: false,
          telos: {
            requiredEnv: ['JIRA_TOKEN'],
            requiredPaths: [],
            requiredMcpServers: [],
          },
        },
      }))
      const issues = m.readinessIssuesFor(workspace(), {})
      expect(issues).toEqual([{ kind: 'missing-env', target: 'JIRA_TOKEN' }])
    })

    it('reports missing MCP servers', () => {
      const m = new SkillManifest(manifestData({
        frontmatter: {
          name: 'x',
          description: 'y',
          disableModelInvocation: false,
          telos: {
            requiredEnv: [],
            requiredPaths: [],
            requiredMcpServers: ['xwiki' as McpServerId],
          },
        },
      }))
      const issues = m.readinessIssuesFor(workspace({ withMcpServer: 'redmine' as McpServerId }), {})
      expect(issues).toEqual([{ kind: 'missing-mcp-server', target: 'xwiki' }])
    })
  })

  it('toData returns underlying data', () => {
    const data = manifestData()
    const m = new SkillManifest(data)
    expect(m.toData()).toBe(data)
  })
})
