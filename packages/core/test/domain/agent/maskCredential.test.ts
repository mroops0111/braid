import { describe, expect, it } from 'vitest'
import { maskCredential } from '../../../src/domain/agent/maskCredential.js'

const REAL_LENGTH = 'sk-ant-oat01-'.length + 95

function credentialOf(length: number): string {
  return `sk-ant-oat01-${'x'.repeat(length - 'sk-ant-oat01-'.length - 6)}Ss8wAA`
}

describe('maskCredential', () => {
  // Four trailing characters cannot separate two tokens from one account,
  // which is the whole reason a reader is shown anything at all.
  it('shows both ends of a credential', () => {
    expect(maskCredential(credentialOf(REAL_LENGTH))).toBe('sk-ant-oat01…Ss8wAA')
  })

  // The rest is what an onlooker would need,
  // so the visible part has to stay a small fraction of the whole.
  it('hides the overwhelming majority of it', () => {
    const credential = credentialOf(REAL_LENGTH)
    const masked = maskCredential(credential)
    expect(masked.length).toBeLessThan(credential.length / 4)
  })

  it('never contains the middle', () => {
    const credential = `sk-ant-oat01-${'SECRETMIDDLE'.repeat(8)}Ss8wAA`
    expect(maskCredential(credential)).not.toContain('SECRETMIDDLE')
  })

  // Both ends of a short value would be most of it,
  // so a credential too short to split falls back to a tail alone.
  it('shows only a tail for a credential too short to split', () => {
    expect(maskCredential('short-one-1234')).toBe('…1234')
  })

  it('leaves nothing recognisable of a very short one', () => {
    expect(maskCredential('abcdefgh')).toBe('…efgh')
  })
})
