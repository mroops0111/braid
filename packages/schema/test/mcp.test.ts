import { describe, expect, it } from 'vitest'
import { McpServerConfig, McpServerId, McpTransport } from '../src/index.js'

describe('mcpServerId (branded)', () => {
  it('accepts any non-empty string', () => {
    expect(McpServerId.parse('redmine')).toBe('redmine')
  })
  it('rejects empty', () => {
    expect(McpServerId.safeParse('').success).toBe(false)
  })
})

describe('mcpTransport', () => {
  it('accepts stdio / sse / http', () => {
    expect(McpTransport.parse('stdio')).toBe('stdio')
    expect(McpTransport.parse('sse')).toBe('sse')
    expect(McpTransport.parse('http')).toBe('http')
  })
  it('rejects unknown transport', () => {
    expect(McpTransport.safeParse('grpc').success).toBe(false)
  })
})

describe('mcpServerConfig (discriminated union)', () => {
  it('parses a stdio server', () => {
    const config = McpServerConfig.parse({
      id: 'redmine',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@telos/mcp-redmine'],
      env: { REDMINE_API_KEY: 'xxx' },
    })
    if (config.transport !== 'stdio')
      throw new Error('unexpected')
    expect(config.command).toBe('npx')
  })

  it('parses an sse server', () => {
    const config = McpServerConfig.parse({
      id: 'remote',
      transport: 'sse',
      url: 'https://mcp.example.com/sse',
    })
    if (config.transport !== 'sse')
      throw new Error('unexpected')
    expect(config.url).toBe('https://mcp.example.com/sse')
  })

  it('parses an http server', () => {
    const config = McpServerConfig.parse({
      id: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com',
    })
    expect(config.transport).toBe('http')
  })

  it('rejects invalid stdio without command', () => {
    expect(
      McpServerConfig.safeParse({ id: 'a', transport: 'stdio', args: [] }).success,
    ).toBe(false)
  })
})
