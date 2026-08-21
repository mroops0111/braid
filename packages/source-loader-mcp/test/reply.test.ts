import { describe, expect, it } from 'vitest'
import { assertNotError, payloadOf } from '../src/client.js'
import { interpolateEnv, McpLoaderConfig, readPath } from '../src/config.js'
import { renderItem, toFilename } from '../src/item.js'

describe('reading a reply', () => {
  it('prefers the structured payload, which is what a shaped tool sends', () => {
    expect(payloadOf({ structuredContent: { items: [1] }, content: [{ type: 'text', text: '{}' }] }))
      .toEqual({ items: [1] })
  })

  it('falls back to the first text block, which is how a bare array arrives', () => {
    expect(payloadOf({ content: [{ type: 'text', text: '[{"id":1}]' }] })).toEqual([{ id: 1 }])
  })

  it('ignores a non-text block while looking for one', () => {
    expect(payloadOf({ content: [{ type: 'image' }, { type: 'text', text: '[]' }] })).toEqual([])
  })

  it('says so when the text is not JSON, rather than mirroring nothing', () => {
    expect(() => payloadOf({ content: [{ type: 'text', text: 'Gateway Timeout' }] }))
      .toThrow(/not JSON/)
  })

  it('yields nothing when the reply carries no payload at all', () => {
    expect(payloadOf({})).toBeUndefined()
    expect(payloadOf({ content: [{ type: 'image' }] })).toBeUndefined()
  })
})

describe('a failed call', () => {
  it('raises with the server\'s own message', () => {
    expect(() => assertNotError({ isError: true, content: [{ type: 'text', text: 'boom' }] }, 'list_items'))
      .toThrow(/list_items.*boom/)
  })

  it('raises even when the server explains nothing', () => {
    expect(() => assertNotError({ isError: true }, 'list_items')).toThrow(/list_items/)
  })

  it('passes a successful call through', () => {
    expect(() => assertNotError({ structuredContent: {} }, 'list_items')).not.toThrow()
  })
})

describe('reading a dotted path', () => {
  it('walks each segment', () => {
    expect(readPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1)
  })

  it('stops at the first missing step, rather than throwing', () => {
    expect(readPath({ a: {} }, 'a.b.c')).toBeUndefined()
    expect(readPath(null, 'a')).toBeUndefined()
    expect(readPath({ a: 'text' }, 'a.b')).toBeUndefined()
  })
})

describe('a filename drawn from an upstream id', () => {
  it('keeps an id that is already safe', () => {
    expect(toFilename('ABC-1')).toBe('ABC-1.md')
  })

  it('cannot escape its directory', () => {
    expect(toFilename('../../etc/passwd')).toBe('etc-passwd.md')
    expect(toFilename('a/b')).toBe('a-b.md')
  })

  it('still yields a name when nothing survives', () => {
    expect(toFilename('///')).toBe('item.md')
  })
})

describe('rendering one item', () => {
  const config = McpLoaderConfig.parse({ url: 'https://gateway.internal/mcp' })

  it('refuses an item with no id, which could never be tracked', () => {
    expect(() => renderItem({ title: 'No id' }, config)).toThrow(/no id/)
    expect(() => renderItem('a string', config)).toThrow(/expected an object/)
  })

  it('renders an item that carries only an id', () => {
    const item = renderItem({ id: 4 }, config)
    expect(item.markdown).toBe('---\nid: "4"\n---\n')
    expect(item.updatedAt).toBe('')
  })

  it('drops a nested value rather than serialising it', () => {
    const item = renderItem({ id: 1, author: { name: 'ana' }, state: 'open' }, config)
    expect(item.markdown).toContain('state: open')
    expect(item.markdown).not.toContain('ana')
  })
})

describe('interpolating the environment', () => {
  it('leaves a plain value alone', () => {
    expect(interpolateEnv('https://gateway.internal/mcp', {})).toBe('https://gateway.internal/mcp')
  })

  it('replaces every occurrence', () => {
    // eslint-disable-next-line no-template-curly-in-string -- intentional: testing literal ${VAR} interpolation
    expect(interpolateEnv('${A}/${A}', { A: 'x' })).toBe('x/x')
  })
})
