import { describe, expect, it } from 'vitest'
import { McpServerConfig, McpServerId, McpTransport } from '../src/index.js'

describe('McpServerId (branded)', () => {
  it('accepts any non-empty string', () => {
    expect(McpServerId.parse('redmine')).toBe('redmine')
  })
  it('rejects empty', () => {
    expect(McpServerId.safeParse('').success).toBe(false)
  })
})

describe('McpTransport', () => {
  it('accepts streamable-http (the only supported transport for v0.1)', () => {
    expect(McpTransport.parse('streamable-http')).toBe('streamable-http')
  })
  it('rejects deprecated transports', () => {
    expect(McpTransport.safeParse('stdio').success).toBe(false)
    expect(McpTransport.safeParse('sse').success).toBe(false)
    expect(McpTransport.safeParse('http').success).toBe(false)
    expect(McpTransport.safeParse('grpc').success).toBe(false)
  })
})

describe('McpServerConfig (discriminated union)', () => {
  it('parses a streamable-http server with headers', () => {
    const config = McpServerConfig.parse({
      id: 'redmine-prod',
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      // eslint-disable-next-line no-template-curly-in-string -- literal placeholder for runtime env interpolation
      headers: { Authorization: 'Bearer ${REDMINE_TOKEN}' },
    })
    expect(config.transport).toBe('streamable-http')
    expect(config.url).toBe('https://mcp.example.com/mcp')
    expect(config.headers?.Authorization).toContain('REDMINE_TOKEN')
  })

  it('parses without headers', () => {
    const config = McpServerConfig.parse({
      id: 'public',
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
    })
    expect(config.transport).toBe('streamable-http')
  })

  it('rejects non-URL', () => {
    expect(McpServerConfig.safeParse({
      id: 'bad',
      transport: 'streamable-http',
      url: 'not-a-url',
    }).success).toBe(false)
  })
})
