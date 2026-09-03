import { describe, expect, it } from 'vitest'
import { chooseLoginMode } from '../../../src/infrastructure/auth/loginMode.js'

const OIDC = {
  BRAID_OIDC_ISSUER: 'https://as.example.com',
  BRAID_OIDC_CLIENT_ID: 'braid',
  BRAID_OIDC_CLIENT_SECRET: 'shh',
}

describe('chooseLoginMode', () => {
  it('signs people in through the authorization server when one is named', () => {
    expect(chooseLoginMode(OIDC, { googleConfigured: true })).toEqual({
      kind: 'oidc',
      issuer: 'https://as.example.com',
      clientId: 'braid',
      clientSecret: 'shh',
    })
  })

  it('falls back to Google only when no authorization server is named', () => {
    expect(chooseLoginMode({}, { googleConfigured: true })).toEqual({ kind: 'google' })
  })

  it('refuses to fall back to Google when the issuer is named but incomplete', () => {
    // Falling back here would sign people in against the very provider the
    // deployment just said an authorization server replaces, quietly giving
    // one person two identities.
    const mode = chooseLoginMode({ BRAID_OIDC_ISSUER: 'https://as.example.com' }, { googleConfigured: true })
    expect(mode.kind).toBe('none')
    expect(mode.kind === 'none' && mode.reason).toContain('BRAID_OIDC_CLIENT_ID')
    expect(mode.kind === 'none' && mode.reason).toContain('BRAID_OIDC_CLIENT_SECRET')
  })

  it('names the one missing half rather than both', () => {
    const mode = chooseLoginMode({ ...OIDC, BRAID_OIDC_CLIENT_SECRET: undefined }, { googleConfigured: false })
    expect(mode.kind === 'none' && mode.reason).toContain('BRAID_OIDC_CLIENT_SECRET')
    expect(mode.kind === 'none' && mode.reason).not.toContain('BRAID_OIDC_CLIENT_ID ')
  })

  it('leaves nobody able to sign in when nothing is configured', () => {
    expect(chooseLoginMode({}, { googleConfigured: false }).kind).toBe('none')
  })
})
