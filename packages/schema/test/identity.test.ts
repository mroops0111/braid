import { describe, expect, it } from 'vitest'
import { isServiceAccount, REACTOR_USER_ID, SERVICE_ACCOUNTS } from '../src/identity.js'

describe('service accounts', () => {
  it('recognises the reactor as a service account', () => {
    expect(isServiceAccount(REACTOR_USER_ID)).toBe(true)
    expect(isServiceAccount('reactor')).toBe(true)
  })

  it('recognises the generic system principal', () => {
    expect(isServiceAccount('system')).toBe(true)
  })

  it('does not treat a human user id as a service account', () => {
    expect(isServiceAccount('usr-7176d698')).toBe(false)
    expect(isServiceAccount('local-user')).toBe(false)
  })

  it('declares a display name for every service account', () => {
    expect(SERVICE_ACCOUNTS.every(account => account.displayName.length > 0)).toBe(true)
  })
})
