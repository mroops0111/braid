import { describe, expect, it } from 'vitest'
import { getCurrentUserId, LOCAL_USER_ID } from '../../src/lib/currentUser'

describe('getCurrentUserId', () => {
  it('returns the stable local-user id', () => {
    expect(getCurrentUserId()).toBe(LOCAL_USER_ID)
    expect(LOCAL_USER_ID).toBe('local-user')
  })
})
