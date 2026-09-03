import { describe, expect, it } from 'vitest'
import { canSignOut } from '../../src/lib/authToken'

describe('canSignOut', () => {
  it('offers the action on a server that requires auth and holds a token', () => {
    expect(canSignOut({ token: 'jwt', requiresAuth: true })).toBe(true)
  })

  it('withholds it on a local-trust server, where the gate ignores the token', () => {
    // This is the case that looked broken. Signing out cleared the token,
    // the gate re-evaluated, saw a server that requires no auth,
    // and returned authenticated again, so the screen never changed.
    expect(canSignOut({ token: 'jwt', requiresAuth: false })).toBe(false)
  })

  it('withholds it when there is no session to leave', () => {
    expect(canSignOut({ token: null, requiresAuth: true })).toBe(false)
    expect(canSignOut({ token: '', requiresAuth: true })).toBe(false)
  })
})
