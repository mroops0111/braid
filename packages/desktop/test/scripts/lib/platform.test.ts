import { describe, expect, it } from 'vitest'
// @ts-expect-error - .mjs source has no .d.ts; signature is exercised by callers.
import { nodeDistInfo, rustTargetTriple } from '../../../scripts/lib/platform.mjs'

describe('rustTargetTriple', () => {
  it.each([
    [{ platform: 'darwin', arch: 'arm64' }, 'aarch64-apple-darwin'],
    [{ platform: 'darwin', arch: 'x64' }, 'x86_64-apple-darwin'],
    [{ platform: 'linux', arch: 'arm64' }, 'aarch64-unknown-linux-gnu'],
    [{ platform: 'linux', arch: 'x64' }, 'x86_64-unknown-linux-gnu'],
    [{ platform: 'win32', arch: 'x64' }, 'x86_64-pc-windows-msvc'],
  ])('maps %j to %s', (host, expected) => {
    expect(rustTargetTriple(host)).toBe(expected)
  })

  it('honours the override before inspecting the host', () => {
    expect(rustTargetTriple({ platform: 'linux', arch: 'x64', override: 'aarch64-apple-darwin' }))
      .toBe('aarch64-apple-darwin')
  })

  it('throws on an unsupported host', () => {
    expect(() => rustTargetTriple({ platform: 'sunos', arch: 'sparc' })).toThrow('Unsupported host: sunos-sparc')
  })
})

describe('nodeDistInfo', () => {
  const v = '22.21.1'

  it('returns the macOS arm64 tarball', () => {
    expect(nodeDistInfo('aarch64-apple-darwin', v)).toEqual({
      file: `node-v${v}-darwin-arm64.tar.gz`,
      format: 'tgz',
      binPath: 'bin/node',
    })
  })

  it('returns the macOS x64 tarball', () => {
    expect(nodeDistInfo('x86_64-apple-darwin', v)).toEqual({
      file: `node-v${v}-darwin-x64.tar.gz`,
      format: 'tgz',
      binPath: 'bin/node',
    })
  })

  it('returns the linux arm64 .tar.xz', () => {
    expect(nodeDistInfo('aarch64-unknown-linux-gnu', v)).toEqual({
      file: `node-v${v}-linux-arm64.tar.xz`,
      format: 'txz',
      binPath: 'bin/node',
    })
  })

  it('returns the linux x64 .tar.xz', () => {
    expect(nodeDistInfo('x86_64-unknown-linux-gnu', v)).toEqual({
      file: `node-v${v}-linux-x64.tar.xz`,
      format: 'txz',
      binPath: 'bin/node',
    })
  })

  it('returns the windows zip with node.exe', () => {
    expect(nodeDistInfo('x86_64-pc-windows-msvc', v)).toEqual({
      file: `node-v${v}-win-x64.zip`,
      format: 'zip',
      binPath: 'node.exe',
    })
  })

  it('throws when the triple has no mapping', () => {
    expect(() => nodeDistInfo('riscv64gc-unknown-linux-gnu', v))
      .toThrow('No Node distribution mapping for riscv64gc-unknown-linux-gnu')
  })
})
