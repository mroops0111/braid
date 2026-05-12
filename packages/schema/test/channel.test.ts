import { describe, expect, it } from 'vitest'
import { ChannelDescriptor, ChannelKind, HttpChannelConfig } from '../src/index.js'

describe('channelKind (open brand)', () => {
  it('accepts http', () => {
    expect(ChannelKind.parse('http')).toBe('http')
  })
  it('accepts future kinds like mcp / vscode / slack', () => {
    expect(ChannelKind.parse('mcp')).toBe('mcp')
    expect(ChannelKind.parse('vscode')).toBe('vscode')
  })
})

describe('channelDescriptor', () => {
  it('parses an http channel', () => {
    const desc = ChannelDescriptor.parse({
      kind: 'http',
      config: { port: 4321 },
    })
    expect(desc.kind).toBe('http')
  })
})

describe('httpChannelConfig', () => {
  it('defaults port to 4321', () => {
    expect(HttpChannelConfig.parse({}).port).toBe(4321)
  })

  it('accepts custom port', () => {
    expect(HttpChannelConfig.parse({ port: 8080 }).port).toBe(8080)
  })
})
