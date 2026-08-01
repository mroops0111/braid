import type { UserAuthor, UserDirectory } from '@braidhq/core'
import type { CommitMessage, UserId } from '@braidhq/schema'
import { enrichCommitAuthor, noopUserDirectory } from '@braidhq/core'
import { describe, expect, it } from 'vitest'

const baseMessage: CommitMessage = {
  kind: 'config',
  subject: 'edit source',
  userId: 'u-1' as UserId,
}

function directoryReturning(author: UserAuthor): UserDirectory {
  return { resolve: async () => author }
}

describe('enrichCommitAuthor', () => {
  it('passes the message through when an author name is already set', async () => {
    const message = { ...baseMessage, authorName: 'Ada' }
    const result = await enrichCommitAuthor(message, directoryReturning({ displayName: 'Ignored' }))
    expect(result).toBe(message)
  })

  it('passes the message through when the directory has no record', async () => {
    const result = await enrichCommitAuthor(baseMessage, noopUserDirectory)
    expect(result).toBe(baseMessage)
  })

  it('snapshots displayName and email into the message', async () => {
    const result = await enrichCommitAuthor(baseMessage, directoryReturning({ displayName: 'Ada', email: 'ada@braid.local' }))
    expect(result.authorName).toBe('Ada')
    expect(result.authorEmail).toBe('ada@braid.local')
  })

  it('omits authorEmail when the record has no email', async () => {
    const result = await enrichCommitAuthor(baseMessage, directoryReturning({ displayName: 'Ada' }))
    expect(result.authorName).toBe('Ada')
    expect(result.authorEmail).toBeUndefined()
  })
})
