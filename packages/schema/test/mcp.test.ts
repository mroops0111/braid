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
  it('accepts streamable-http for workspace-declared third-party servers', () => {
    expect(McpTransport.parse('streamable-http')).toBe('streamable-http')
  })
  it('accepts stdio for child-process gateways (braid-core via uvx)', () => {
    expect(McpTransport.parse('stdio')).toBe('stdio')
  })
  it('rejects unsupported transport names', () => {
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
    if (config.transport === 'streamable-http') {
      expect(config.url).toBe('https://mcp.example.com/mcp')
      expect(config.headers?.Authorization).toContain('REDMINE_TOKEN')
    }
  })

  it('parses streamable-http without headers', () => {
    const config = McpServerConfig.parse({
      id: 'public',
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
    })
    expect(config.transport).toBe('streamable-http')
  })

  it('rejects non-URL on streamable-http', () => {
    expect(McpServerConfig.safeParse({
      id: 'bad',
      transport: 'streamable-http',
      url: 'not-a-url',
    }).success).toBe(false)
  })

  it('parses a stdio server with command + args + env', () => {
    const config = McpServerConfig.parse({
      id: 'braid-core',
      transport: 'stdio',
      command: 'uvx',
      args: ['openapi-mcp-gateway', '--spec', 'http://127.0.0.1:4321/openapi.json', '--transport', 'stdio'],
      env: { LOG_LEVEL: 'info' },
    })
    expect(config.transport).toBe('stdio')
    if (config.transport === 'stdio') {
      expect(config.command).toBe('uvx')
      expect(config.args).toContain('openapi-mcp-gateway')
      expect(config.env?.LOG_LEVEL).toBe('info')
    }
  })

  it('parses stdio without optional args / env', () => {
    const config = McpServerConfig.parse({
      id: 'tiny',
      transport: 'stdio',
      command: '/usr/local/bin/mcp-tiny',
    })
    expect(config.transport).toBe('stdio')
  })

  it('rejects empty stdio command', () => {
    expect(McpServerConfig.safeParse({
      id: 'bad',
      transport: 'stdio',
      command: '',
    }).success).toBe(false)
  })
})
