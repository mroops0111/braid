import { describe, expect, it } from 'vitest'
import { formatArgsPreview } from '@/components/SkillTranscript/formatArgsPreview'

describe('formatArgsPreview', () => {
  it('returns empty string for null / undefined', () => {
    expect(formatArgsPreview(null)).toBe('')
    expect(formatArgsPreview(undefined)).toBe('')
  })

  it('returns truncated string for non-object input', () => {
    expect(formatArgsPreview(42)).toBe('42')
    expect(formatArgsPreview('a'.repeat(100))).toMatch(/…$/)
  })

  it('prefers `command` then `file_path` then `path` then `query` then `url`', () => {
    expect(formatArgsPreview({ command: 'ls', file_path: '/x' })).toBe('ls')
    expect(formatArgsPreview({ file_path: '/x', path: '/y' })).toBe('/x')
    expect(formatArgsPreview({ path: '/y', query: 'q' })).toBe('/y')
    expect(formatArgsPreview({ query: 'q', url: 'http://x' })).toBe('q')
    expect(formatArgsPreview({ url: 'http://x' })).toBe('http://x')
  })

  it('falls back to JSON.stringify when no preferred field is a string', () => {
    expect(formatArgsPreview({ foo: 1, bar: true })).toBe('{"foo":1,"bar":true}')
  })

  it('truncates to 80 chars with ellipsis', () => {
    const long = 'x'.repeat(200)
    const preview = formatArgsPreview({ command: long })
    expect(preview.length).toBe(80)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('ignores non-string values in preferred fields', () => {
    expect(formatArgsPreview({ command: 42, file_path: '/x' })).toBe('/x')
  })
})
