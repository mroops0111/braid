import { describe, expect, it } from 'vitest'
import { LineBuffer } from '../../../src/infrastructure/skill/lineBuffer.js'

describe('LineBuffer', () => {
  it('splits chunked text on newlines', () => {
    const lines: string[] = []
    const buffer = new LineBuffer(line => lines.push(line))
    buffer.append('hello\nworld\n')
    expect(lines).toEqual(['hello', 'world'])
  })

  it('handles partial lines across chunks', () => {
    const lines: string[] = []
    const buffer = new LineBuffer(line => lines.push(line))
    buffer.append('hel')
    buffer.append('lo\nwo')
    buffer.append('rld\n')
    expect(lines).toEqual(['hello', 'world'])
  })

  it('flush emits trailing line without terminator', () => {
    const lines: string[] = []
    const buffer = new LineBuffer(line => lines.push(line))
    buffer.append('partial')
    buffer.flush()
    expect(lines).toEqual(['partial'])
  })

  it('skips empty lines', () => {
    const lines: string[] = []
    const buffer = new LineBuffer(line => lines.push(line))
    buffer.append('a\n\nb\n')
    expect(lines).toEqual(['a', 'b'])
  })
})
