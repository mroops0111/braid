import type { AbsolutePath, McpServerId } from '@braidhq/schema'
import { makeSkillManifest, makeSkillManifestData, makeWorkspace } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { SkillManifest } from '../../../src/index.js'

const REDMINE_MCP = {
  id: 'redmine' as McpServerId,
  transport: 'streamable-http' as const,
  url: 'https://example.com/mcp',
}

function workspaceWith(mcpServerId: McpServerId | null = 'redmine' as McpServerId) {
  return makeWorkspace({
    mcpServers: mcpServerId ? [{ ...REDMINE_MCP, id: mcpServerId }] : [],
  })
}

describe('SkillManifest origin checks', () => {
  it('isBuiltin returns true for the builtin origin', () => {
    expect(makeSkillManifest({ origin: 'builtin' }).isBuiltin()).toBe(true)
  })

  it('isBuiltin returns false for a workspace-installed skill', () => {
    expect(makeSkillManifest({ origin: 'workspace' }).isBuiltin()).toBe(false)
  })

  it('isExtended returns true when an extensionPath is recorded', () => {
    const manifest = makeSkillManifest({ extensionPath: '/abs/extend' as AbsolutePath })
    expect(manifest.isExtended()).toBe(true)
  })

  it('isExtended returns false when no extensionPath is set', () => {
    expect(makeSkillManifest().isExtended()).toBe(false)
  })
})

describe('SkillManifest.requiresMcpServer', () => {
  it('returns true only for ids listed in braid.requiredMcpServers', () => {
    const manifest = makeSkillManifest({ requiredMcpServers: ['redmine' as McpServerId] })

    expect(manifest.requiresMcpServer('redmine' as McpServerId)).toBe(true)
    expect(manifest.requiresMcpServer('xwiki' as McpServerId)).toBe(false)
  })
})

describe('SkillManifest claude / braid field projections', () => {
  it('claudeCodeFields drops the braid namespace', () => {
    const manifest = makeSkillManifest({ id: 'braid:ask', name: 'ask', description: 'answer questions' })

    expect(manifest.claudeCodeFields).toEqual({
      name: 'ask',
      description: 'answer questions',
      disableModelInvocation: false,
    })
  })

  it('braidFields exposes the braid extension block', () => {
    const manifest = new SkillManifest(makeSkillManifestData({
      requiredEnv: ['JIRA_TOKEN'],
      requiredMcpServers: ['redmine' as McpServerId],
    }))

    expect(manifest.braidFields.requiredEnv).toEqual(['JIRA_TOKEN'])
  })
})

describe('SkillManifest.readinessIssuesFor', () => {
  it('reports no issues when env and MCP requirements are satisfied', () => {
    const manifest = makeSkillManifest({
      requiredEnv: ['BRAID_API_URL'],
      requiredMcpServers: ['redmine' as McpServerId],
    })

    const issues = manifest.readinessIssuesFor(workspaceWith(), { BRAID_API_URL: 'http://localhost' })
    expect(issues).toEqual([])
  })

  it('reports a missing-env issue for each unset required environment variable', () => {
    const manifest = makeSkillManifest({ requiredEnv: ['JIRA_TOKEN'] })

    const issues = manifest.readinessIssuesFor(workspaceWith(), {})
    expect(issues).toEqual([{ kind: 'missing-env', target: 'JIRA_TOKEN' }])
  })

  it('reports a missing-mcp-server issue when the workspace does not declare the server', () => {
    const manifest = makeSkillManifest({ requiredMcpServers: ['xwiki' as McpServerId] })

    const issues = manifest.readinessIssuesFor(workspaceWith('redmine' as McpServerId), {})
    expect(issues).toEqual([{ kind: 'missing-mcp-server', target: 'xwiki' }])
  })
})
