import { describe, expect, it } from 'vitest'
// @ts-expect-error - .mjs source has no .d.ts; signature is exercised by callers.
import { targetTriple } from '../../scripts/lib/triple.mjs'

describe('targetTriple', () => {
  it.each([
    [{ platform: 'darwin', arch: 'arm64' }, 'darwin-arm64'],
    [{ platform: 'darwin', arch: 'x64' }, 'darwin-x64'],
    [{ platform: 'linux', arch: 'arm64' }, 'linux-arm64'],
    [{ platform: 'linux', arch: 'x64' }, 'linux-x64'],
    [{ platform: 'win32', arch: 'x64' }, 'win32-x64'],
  ])('maps %j to %s', (host, expected) => {
    expect(targetTriple(host)).toBe(expected)
  })

  it('honours the override before inspecting the host', () => {
    expect(targetTriple({ platform: 'darwin', arch: 'arm64', override: 'win32-x64' })).toBe('win32-x64')
  })

  it('throws on an unsupported host', () => {
    expect(() => targetTriple({ platform: 'sunos', arch: 'sparc' })).toThrow('Unsupported bundle target: sunos-sparc')
  })
})
