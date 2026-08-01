import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { ServerRole, User, UserCreate, UserUpdate } from '../src/index.js'

describe('ServerRole', () => {
  it('has admin and user', () => {
    expect(ServerRole.options).toEqual(['admin', 'user'])
  })
  it('rejects an unknown role', () => {
    expect(ServerRole.safeParse('superuser').success).toBe(false)
  })
})

describe('User', () => {
  const valid = { id: 'u-1', displayName: 'Ada', createdAt: isoTimestamp }

  it('defaults serverRole to user', () => {
    expect(User.parse(valid).serverRole).toBe('user')
  })
  it('rejects an empty displayName', () => {
    expect(User.safeParse({ ...valid, displayName: '' }).success).toBe(false)
  })
  it('rejects a malformed email', () => {
    expect(User.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
  })
  it('requires id and createdAt', () => {
    expect(User.safeParse({ displayName: 'Ada' }).success).toBe(false)
  })
})

describe('UserCreate', () => {
  it('accepts input without id or createdAt', () => {
    const created = UserCreate.parse({ displayName: 'Ada' })
    expect(created.displayName).toBe('Ada')
  })
  it('still requires displayName', () => {
    expect(UserCreate.safeParse({}).success).toBe(false)
  })
})

describe('UserUpdate', () => {
  it('makes every field optional', () => {
    expect(UserUpdate.parse({})).toEqual({})
  })
  it('drops googleSub, a rename cannot rewrite identity', () => {
    expect(UserUpdate.parse({ googleSub: 'x' })).toEqual({})
  })
})
